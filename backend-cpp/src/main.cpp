#include <drogon/drogon.h>
#include <sqlite3.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <functional>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>

namespace {

using Json::Value;
using drogon::HttpRequestPtr;
using drogon::HttpResponsePtr;

long long toInt64(const Value &value, long long fallback = 0);
Value errorJson(const std::string &message);

struct SlotRecord {
    bool exists = false;
    std::string teamName;
    Value reservedSlots = Value(Json::arrayValue);
    std::string status;
    Value member = Value(Json::nullValue);
    std::optional<std::string> fixedRole;
    std::optional<int> fixedMartialArtIndex;
};

class SqliteDb {
public:
    explicit SqliteDb(const std::filesystem::path &path) {
        std::filesystem::create_directories(path.parent_path());
        if (sqlite3_open(path.string().c_str(), &db_) != SQLITE_OK) {
            throw std::runtime_error(sqlite3_errmsg(db_));
        }
        exec("PRAGMA journal_mode=WAL;");
        exec("PRAGMA foreign_keys=ON;");
        exec("PRAGMA busy_timeout=3000;");
    }

    ~SqliteDb() {
        if (db_ != nullptr) {
            sqlite3_close(db_);
        }
    }

    SqliteDb(const SqliteDb &) = delete;
    SqliteDb &operator=(const SqliteDb &) = delete;

    void exec(const std::string &sql) {
        char *error = nullptr;
        if (sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &error) != SQLITE_OK) {
            std::string message = error != nullptr ? error : "sqlite error";
            sqlite3_free(error);
            throw std::runtime_error(message);
        }
    }

    Value versions() {
        std::lock_guard lock(mutex_);
        ensureSchema();
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT data_version, lock_version FROM meta_versions WHERE id = 1", &stmt);
        Value json;
        json["ok"] = true;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            json["dataVersion"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 0));
            json["lockVersion"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 1));
        } else {
            json["dataVersion"] = 1;
            json["lockVersion"] = 1;
        }
        sqlite3_finalize(stmt);
        return json;
    }

    Value replaceData(const Value &data) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        exec("BEGIN IMMEDIATE;");
        try {
            replaceDataUnlocked(data);
            bumpDataVersionUnlocked();
            bumpLockVersionUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        Value snapshot = bootstrapUnlocked();
        snapshot["ok"] = true;
        return snapshot;
    }

    Value publicLocks() {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value json;
        json["slots"] = Value(Json::arrayValue);
        json["teams"] = Value(Json::arrayValue);

        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT team_id, slot_index, qq, timestamp FROM slot_locks ORDER BY team_id, slot_index", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value item;
            item["teamId"] = textColumn(stmt, 0);
            item["slotIndex"] = sqlite3_column_int(stmt, 1);
            item["qq"] = textColumn(stmt, 2);
            item["timestamp"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 3));
            json["slots"].append(item);
        }
        sqlite3_finalize(stmt);

        prepare("SELECT team_id, timestamp FROM team_locks ORDER BY team_id", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value item;
            item["teamId"] = textColumn(stmt, 0);
            item["timestamp"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 1));
            json["teams"].append(item);
        }
        sqlite3_finalize(stmt);

        auto version = versionsUnlocked();
        json["lockVersion"] = version["lockVersion"];
        return json;
    }

    Value bootstrap() {
        std::lock_guard lock(mutex_);
        ensureSchema();
        return bootstrapUnlocked();
    }

    Value sync(std::optional<long long> dataVersion, std::optional<long long> lockVersion) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value current = versionsUnlocked();
        const auto currentData = current["dataVersion"].asInt64();
        const auto currentLocks = current["lockVersion"].asInt64();
        const bool dataChanged = !dataVersion.has_value() || *dataVersion != currentData;
        const bool lockChanged = !lockVersion.has_value() || *lockVersion != currentLocks;
        Value json = current;
        json["dataChanged"] = dataChanged;
        json["lockChanged"] = lockChanged;
        if (dataChanged) {
            Value data = bootstrapUnlocked();
            json["data"] = data;
        }
        if (lockChanged) {
            json["locks"] = publicLocksUnlocked();
        }
        return json;
    }

    Value acquireSlotLock(const std::string &teamId, int slotIndex, const std::string &qq) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const auto now = nowMs();
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare("SELECT timestamp FROM team_locks WHERE team_id = ?", &stmt);
            sqlite3_bind_text(stmt, 1, teamId.c_str(), -1, SQLITE_TRANSIENT);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                const auto lockedAt = sqlite3_column_int64(stmt, 0);
                sqlite3_finalize(stmt);
                exec("ROLLBACK;");
                Value conflict;
                conflict["ok"] = false;
                conflict["reason"] = "teamLocked";
                conflict["lockedAt"] = static_cast<Json::Int64>(lockedAt);
                return conflict;
            }
            sqlite3_finalize(stmt);

            prepare("SELECT qq, timestamp FROM slot_locks WHERE team_id = ? AND slot_index = ?", &stmt);
            sqlite3_bind_text(stmt, 1, teamId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int(stmt, 2, slotIndex);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                const std::string owner = textColumn(stmt, 0);
                const auto lockedAt = sqlite3_column_int64(stmt, 1);
                if (owner != qq && now - lockedAt < lockTimeoutMs_) {
                    sqlite3_finalize(stmt);
                    exec("ROLLBACK;");
                    Value conflict;
                    conflict["ok"] = false;
                    conflict["lockedBy"] = owner;
                    conflict["lockedAt"] = static_cast<Json::Int64>(lockedAt);
                    return conflict;
                }
            }
            sqlite3_finalize(stmt);

            prepare(
                "INSERT INTO slot_locks(team_id, slot_index, qq, timestamp) VALUES(?, ?, ?, ?) "
                "ON CONFLICT(team_id, slot_index) DO UPDATE SET qq = excluded.qq, timestamp = excluded.timestamp",
                &stmt);
            sqlite3_bind_text(stmt, 1, teamId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int(stmt, 2, slotIndex);
            sqlite3_bind_text(stmt, 3, qq.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(stmt, 4, now);
            stepDone(stmt);
            sqlite3_finalize(stmt);

            exec("UPDATE meta_versions SET lock_version = lock_version + 1 WHERE id = 1;");
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }

        Value ok;
        ok["ok"] = true;
        ok["timestamp"] = static_cast<Json::Int64>(now);
        ok["lockToken"] = static_cast<Json::Int64>(now);
        return ok;
    }

    Value validateSlotLock(const std::string &teamId, int slotIndex, const std::string &qq, long long lockToken) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        return validateSlotMutationLockUnlocked(teamId, slotIndex, qq, lockToken);
    }

    Value saveSlotMember(
        const std::string &teamId,
        int slotIndex,
        const std::string &actorQq,
        const Value &member,
        long long lockToken,
        std::optional<std::string> expectedMemberQq
    ) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const auto now = nowMs();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value lockCheck = validateSlotMutationLockUnlocked(teamId, slotIndex, actorQq, lockToken);
            if (!lockCheck["ok"].asBool()) {
                exec("ROLLBACK;");
                return lockCheck;
            }

            SlotRecord slot = readSlotUnlocked(teamId, slotIndex);
            if (!slot.exists) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            const std::optional<std::string> currentMemberQq = memberQq(slot.member);
            if (currentMemberQq != expectedMemberQq) {
                exec("ROLLBACK;");
                Value conflict = conflictJson("slotChanged");
                conflict["currentMemberQq"] = currentMemberQq.has_value() ? Value(*currentMemberQq) : Value(Json::nullValue);
                return conflict;
            }

            Value normalizedMember = normalizeMember(member);
            if (!normalizedMember.isObject() || !normalizedMember["qq"].isString() || normalizedMember["qq"].asString().empty()) {
                exec("ROLLBACK;");
                return errorJson("Invalid member");
            }

            sqlite3_stmt *stmt = nullptr;
            prepare("UPDATE slots SET status = 'occupied', member_json = ? WHERE team_id = ? AND slot_index = ?", &stmt);
            bindString(stmt, 1, writeJson(normalizedMember));
            bindString(stmt, 2, teamId);
            sqlite3_bind_int(stmt, 3, slotIndex);
            stepDone(stmt);
            sqlite3_finalize(stmt);

            const std::string action = currentMemberQq.has_value()
                ? "修改 #" + std::to_string(slotIndex + 1) + " 报名：" + normalizedMember["characterId"].asString()
                : "报名 #" + std::to_string(slotIndex + 1) + "：" + normalizedMember["characterId"].asString();
            insertLogUnlocked(teamId, slot.teamName, now, actorQq, action);
            releaseMutationSlotLockUnlocked(teamId, slotIndex, actorQq);
            bumpDataVersionUnlocked();
            bumpLockVersionUnlocked();
            result = mutationOkUnlocked("signupSlot", teamId, slotIndex, normalizedMember);
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value leaveSlotMember(
        const std::string &teamId,
        int slotIndex,
        const std::string &actorQq,
        long long lockToken,
        std::optional<std::string> expectedMemberQq
    ) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const auto now = nowMs();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value lockCheck = validateSlotMutationLockUnlocked(teamId, slotIndex, actorQq, lockToken);
            if (!lockCheck["ok"].asBool()) {
                exec("ROLLBACK;");
                return lockCheck;
            }

            SlotRecord slot = readSlotUnlocked(teamId, slotIndex);
            if (!slot.exists) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            const std::optional<std::string> currentMemberQq = memberQq(slot.member);
            if (currentMemberQq != expectedMemberQq) {
                exec("ROLLBACK;");
                Value conflict = conflictJson("slotChanged");
                conflict["currentMemberQq"] = currentMemberQq.has_value() ? Value(*currentMemberQq) : Value(Json::nullValue);
                return conflict;
            }

            Value previousMember = slot.member;
            const std::string resetStatus = computeResetStatus(slot, slotIndex);
            updateSlotStatusUnlocked(teamId, slotIndex, resetStatus);
            const std::string characterId = previousMember["characterId"].isString() ? previousMember["characterId"].asString() : "";
            std::string action = "退出 #" + std::to_string(slotIndex + 1) + " 报名";
            if (!characterId.empty()) {
                action += "：" + characterId;
            }
            insertLogUnlocked(teamId, slot.teamName, now, actorQq, action);
            releaseMutationSlotLockUnlocked(teamId, slotIndex, actorQq);
            bumpDataVersionUnlocked();
            bumpLockVersionUnlocked();
            result = mutationOkUnlocked("leaveSlot", teamId, slotIndex, resetStatus, Value(Json::nullValue));
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value cancelSlotMember(
        const std::string &teamId,
        int slotIndex,
        const std::string &actorQq,
        const std::string &cancelledBy,
        const std::string &reason,
        long long lockToken,
        std::optional<std::string> expectedMemberQq
    ) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const auto now = nowMs();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value lockCheck = validateSlotMutationLockUnlocked(teamId, slotIndex, actorQq, lockToken);
            if (!lockCheck["ok"].asBool()) {
                exec("ROLLBACK;");
                return lockCheck;
            }

            SlotRecord slot = readSlotUnlocked(teamId, slotIndex);
            if (!slot.exists) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            const std::optional<std::string> currentMemberQq = memberQq(slot.member);
            if (currentMemberQq != expectedMemberQq) {
                exec("ROLLBACK;");
                Value conflict = conflictJson("slotChanged");
                conflict["currentMemberQq"] = currentMemberQq.has_value() ? Value(*currentMemberQq) : Value(Json::nullValue);
                return conflict;
            }

            if (slot.member.isObject()) {
                sqlite3_stmt *stmt = nullptr;
                prepare(
                    "INSERT OR REPLACE INTO cancellations("
                    "qq, reason, cancelled_by, team_id, team_name, slot_index, timestamp"
                    ") VALUES(?, ?, ?, ?, ?, ?, ?)",
                    &stmt);
                bindString(stmt, 1, slot.member["qq"].isString() ? slot.member["qq"].asString() : "");
                bindString(stmt, 2, reason);
                bindString(stmt, 3, cancelledBy);
                bindString(stmt, 4, teamId);
                bindString(stmt, 5, slot.teamName);
                sqlite3_bind_int(stmt, 6, slotIndex);
                sqlite3_bind_int64(stmt, 7, now);
                stepDone(stmt);
                sqlite3_finalize(stmt);
            }

            const std::string characterId = slot.member["characterId"].isString() ? slot.member["characterId"].asString() : "";
            const std::string reset = computeResetStatus(slot, slotIndex);
            updateSlotStatusUnlocked(teamId, slotIndex, reset);
            insertLogUnlocked(teamId, slot.teamName, now, cancelledBy, "取消 #" + std::to_string(slotIndex + 1) + " 报名：" + characterId);
            releaseMutationSlotLockUnlocked(teamId, slotIndex, actorQq);
            bumpDataVersionUnlocked();
            bumpLockVersionUnlocked();
            result = mutationOkUnlocked("cancelSlot", teamId, slotIndex, reset, Value(Json::nullValue));
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    void releaseSlotLock(const std::string &teamId, int slotIndex, const std::string &qq, std::optional<long long> lockToken) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        sqlite3_stmt *stmt = nullptr;
        if (lockToken.has_value()) {
            prepare("DELETE FROM slot_locks WHERE team_id = ? AND slot_index = ? AND qq = ? AND timestamp = ?", &stmt);
            sqlite3_bind_text(stmt, 1, teamId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int(stmt, 2, slotIndex);
            sqlite3_bind_text(stmt, 3, qq.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(stmt, 4, *lockToken);
        } else {
            prepare("DELETE FROM slot_locks WHERE team_id = ? AND slot_index = ? AND qq = ?", &stmt);
            sqlite3_bind_text(stmt, 1, teamId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int(stmt, 2, slotIndex);
            sqlite3_bind_text(stmt, 3, qq.c_str(), -1, SQLITE_TRANSIENT);
        }
        stepDone(stmt);
        const bool changed = sqlite3_changes(db_) > 0;
        sqlite3_finalize(stmt);
        if (changed) {
            exec("UPDATE meta_versions SET lock_version = lock_version + 1 WHERE id = 1;");
        }
    }

    Value setTeamLock(const std::string &teamId) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const auto now = nowMs();
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare(
                "INSERT INTO team_locks(team_id, timestamp) VALUES(?, ?) "
                "ON CONFLICT(team_id) DO UPDATE SET timestamp = excluded.timestamp",
                &stmt);
            bindString(stmt, 1, teamId);
            sqlite3_bind_int64(stmt, 2, now);
            stepDone(stmt);
            sqlite3_finalize(stmt);
            bumpLockVersionUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        Value result = versionsUnlocked();
        result["ok"] = true;
        result["timestamp"] = static_cast<Json::Int64>(now);
        return result;
    }

    Value removeTeamLock(const std::string &teamId) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare("DELETE FROM team_locks WHERE team_id = ?", &stmt);
            bindString(stmt, 1, teamId);
            stepDone(stmt);
            const bool changed = sqlite3_changes(db_) > 0;
            sqlite3_finalize(stmt);
            if (changed) {
                bumpLockVersionUnlocked();
            }
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        Value result = versionsUnlocked();
        result["ok"] = true;
        return result;
    }

    Value subsidyPresets() {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        result["ok"] = true;
        result["presets"] = bootstrapUnlocked()["subsidyPresets"];
        return result;
    }

    Value updateSubsidyPresets(const Value &presets) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        exec("BEGIN IMMEDIATE;");
        try {
            replaceSubsidyPresetsUnlocked(arrayOrEmpty(presets));
            bumpDataVersionUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        Value result = versionsUnlocked();
        result["ok"] = true;
        return result;
    }

private:
    sqlite3 *db_ = nullptr;
    std::mutex mutex_;
    bool schemaReady_ = false;
    const long long lockTimeoutMs_ = 30'000;

    static long long nowMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
    }

    static std::string textColumn(sqlite3_stmt *stmt, int index) {
        const auto *text = sqlite3_column_text(stmt, index);
        return text == nullptr ? "" : reinterpret_cast<const char *>(text);
    }

    void prepare(const std::string &sql, sqlite3_stmt **stmt) {
        if (sqlite3_prepare_v2(db_, sql.c_str(), -1, stmt, nullptr) != SQLITE_OK) {
            throw std::runtime_error(sqlite3_errmsg(db_));
        }
    }

    static void stepDone(sqlite3_stmt *stmt) {
        if (sqlite3_step(stmt) != SQLITE_DONE) {
            throw std::runtime_error(sqlite3_errmsg(sqlite3_db_handle(stmt)));
        }
    }

    static Value parseJson(const std::string &text, Value fallback) {
        if (text.empty()) {
            return fallback;
        }
        Json::CharReaderBuilder builder;
        std::string errors;
        std::istringstream input(text);
        Value parsed;
        if (!Json::parseFromStream(builder, input, &parsed, &errors)) {
            return fallback;
        }
        return parsed;
    }

    static std::string writeJson(const Value &value) {
        Json::StreamWriterBuilder builder;
        builder["indentation"] = "";
        return Json::writeString(builder, value);
    }

    static void bindString(sqlite3_stmt *stmt, int index, const std::string &value) {
        sqlite3_bind_text(stmt, index, value.c_str(), -1, SQLITE_TRANSIENT);
    }

    static void bindOptionalString(sqlite3_stmt *stmt, int index, const std::optional<std::string> &value) {
        if (value.has_value()) {
            bindString(stmt, index, *value);
        } else {
            sqlite3_bind_null(stmt, index);
        }
    }

    static std::optional<std::string> optionalString(const Value &value) {
        if (value.isString()) {
            return value.asString();
        }
        return std::nullopt;
    }

    static Value arrayOrEmpty(const Value &value) {
        return value.isArray() ? value : Value(Json::arrayValue);
    }

    static Value objectOrEmpty(const Value &value) {
        return value.isObject() ? value : Value(Json::objectValue);
    }

    static long long jsonInt64(const Value &value, long long fallback = 0) {
        return toInt64(value, fallback);
    }

    static Value defaultSlot(int index) {
        Value slot;
        slot["index"] = index;
        slot["status"] = "empty";
        slot["member"] = Value(Json::nullValue);
        slot["fixedRole"] = Value(Json::nullValue);
        slot["fixedMartialArtIndex"] = Value(Json::nullValue);
        return slot;
    }

    static Value conflictJson(const std::string &reason) {
        Value json;
        json["ok"] = false;
        json["reason"] = reason;
        return json;
    }

    static std::optional<std::string> memberQq(const Value &member) {
        if (member.isObject() && member["qq"].isString()) {
            return member["qq"].asString();
        }
        return std::nullopt;
    }

    static Value normalizeMember(const Value &member) {
        if (!member.isObject()) {
            return Value(Json::nullValue);
        }
        Value normalized;
        normalized["qq"] = member["qq"].isString() ? member["qq"].asString() : "";
        normalized["martialArtIndex"] = member["martialArtIndex"].isString() ? member["martialArtIndex"].asString() : "";
        normalized["gearScore"] = member["gearScore"].isString() ? member["gearScore"].asString() : "";
        normalized["characterId"] = member["characterId"].isString() ? member["characterId"].asString() : "";
        normalized["note"] = member["note"].isString() ? member["note"].asString() : "";
        if (member.isMember("hasOrangeWeapon")) {
            normalized["hasOrangeWeapon"] = member["hasOrangeWeapon"].asBool();
        }
        return normalized;
    }

    static bool arrayContainsInt(const Value &items, int expected) {
        if (!items.isArray()) {
            return false;
        }
        for (const auto &item : items) {
            if (item.isInt() && item.asInt() == expected) {
                return true;
            }
        }
        return false;
    }

    static std::string computeResetStatus(const SlotRecord &slot, int slotIndex) {
        if (slot.fixedRole.has_value() || slot.fixedMartialArtIndex.has_value()) {
            return "fixed";
        }
        return arrayContainsInt(slot.reservedSlots, slotIndex) ? "reserved" : "empty";
    }

    SlotRecord readSlotUnlocked(const std::string &teamId, int slotIndex) {
        SlotRecord record;
        sqlite3_stmt *stmt = nullptr;
        prepare(
            "SELECT t.name, t.reserved_slots_json, s.status, s.member_json, s.fixed_role, s.fixed_martial_art_index "
            "FROM teams t JOIN slots s ON s.team_id = t.id "
            "WHERE t.id = ? AND s.slot_index = ?",
            &stmt);
        bindString(stmt, 1, teamId);
        sqlite3_bind_int(stmt, 2, slotIndex);
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            record.exists = true;
            record.teamName = textColumn(stmt, 0);
            record.reservedSlots = parseJson(textColumn(stmt, 1), Value(Json::arrayValue));
            record.status = textColumn(stmt, 2);
            record.member = sqlite3_column_type(stmt, 3) == SQLITE_NULL
                ? Value(Json::nullValue)
                : parseJson(textColumn(stmt, 3), Value(Json::nullValue));
            if (sqlite3_column_type(stmt, 4) != SQLITE_NULL) {
                record.fixedRole = textColumn(stmt, 4);
            }
            if (sqlite3_column_type(stmt, 5) != SQLITE_NULL) {
                record.fixedMartialArtIndex = sqlite3_column_int(stmt, 5);
            }
        }
        sqlite3_finalize(stmt);
        return record;
    }

    Value validateSlotMutationLockUnlocked(const std::string &teamId, int slotIndex, const std::string &qq, long long lockToken) {
        if (teamId.empty() || slotIndex < 0 || qq.empty() || lockToken <= 0) {
            return conflictJson("missingFields");
        }

        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT timestamp FROM team_locks WHERE team_id = ? AND timestamp > ?", &stmt);
        bindString(stmt, 1, teamId);
        sqlite3_bind_int64(stmt, 2, lockToken);
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            const auto lockedAt = sqlite3_column_int64(stmt, 0);
            sqlite3_finalize(stmt);
            Value conflict = conflictJson("teamLocked");
            conflict["lockedAt"] = static_cast<Json::Int64>(lockedAt);
            return conflict;
        }
        sqlite3_finalize(stmt);

        prepare("SELECT timestamp FROM slot_locks WHERE team_id = ? AND slot_index = ? AND qq = ?", &stmt);
        bindString(stmt, 1, teamId);
        sqlite3_bind_int(stmt, 2, slotIndex);
        bindString(stmt, 3, qq);
        if (sqlite3_step(stmt) != SQLITE_ROW) {
            sqlite3_finalize(stmt);
            return conflictJson("expired");
        }
        const auto lockedAt = sqlite3_column_int64(stmt, 0);
        sqlite3_finalize(stmt);

        if (lockedAt != lockToken || nowMs() - lockedAt > lockTimeoutMs_) {
            return conflictJson("expired");
        }

        Value ok;
        ok["ok"] = true;
        return ok;
    }

    void updateSlotStatusUnlocked(const std::string &teamId, int slotIndex, const std::string &status) {
        sqlite3_stmt *stmt = nullptr;
        prepare("UPDATE slots SET status = ?, member_json = NULL WHERE team_id = ? AND slot_index = ?", &stmt);
        bindString(stmt, 1, status);
        bindString(stmt, 2, teamId);
        sqlite3_bind_int(stmt, 3, slotIndex);
        stepDone(stmt);
        sqlite3_finalize(stmt);
    }

    void releaseMutationSlotLockUnlocked(const std::string &teamId, int slotIndex, const std::string &qq) {
        sqlite3_stmt *stmt = nullptr;
        prepare("DELETE FROM slot_locks WHERE team_id = ? AND slot_index = ? AND qq = ?", &stmt);
        bindString(stmt, 1, teamId);
        sqlite3_bind_int(stmt, 2, slotIndex);
        bindString(stmt, 3, qq);
        stepDone(stmt);
        sqlite3_finalize(stmt);
    }

    void insertLogUnlocked(
        const std::string &teamId,
        const std::string &teamName,
        long long timestamp,
        const std::string &actorQq,
        const std::string &action
    ) {
        sqlite3_stmt *stmt = nullptr;
        const std::string id = std::to_string(timestamp) + "-" + teamId + "-" + std::to_string(sqlite3_total_changes(db_));
        prepare(
            "INSERT OR REPLACE INTO operation_logs(id, team_id, team_name, timestamp, actor_qq, action) "
            "VALUES(?, ?, ?, ?, ?, ?)",
            &stmt);
        bindString(stmt, 1, id);
        bindString(stmt, 2, teamId);
        bindString(stmt, 3, teamName);
        sqlite3_bind_int64(stmt, 4, timestamp);
        bindString(stmt, 5, actorQq);
        bindString(stmt, 6, action);
        stepDone(stmt);
        sqlite3_finalize(stmt);
    }

    Value mutationOkUnlocked(
        const std::string &type,
        const std::string &teamId,
        int slotIndex,
        const std::string &status,
        const Value &member
    ) {
        Value result = versionsUnlocked();
        result["ok"] = true;
        Value patch;
        patch["type"] = type;
        patch["teamId"] = teamId;
        patch["slotIndex"] = slotIndex;
        patch["slot"] = defaultSlot(slotIndex);
        patch["slot"]["status"] = status;
        patch["slot"]["member"] = member;
        result["patch"] = patch;
        return result;
    }

    Value mutationOkUnlocked(const std::string &type, const std::string &teamId, int slotIndex, const Value &member) {
        return mutationOkUnlocked(type, teamId, slotIndex, "occupied", member);
    }

    void bumpDataVersionUnlocked() {
        exec("UPDATE meta_versions SET data_version = data_version + 1 WHERE id = 1;");
    }

    void bumpLockVersionUnlocked() {
        exec("UPDATE meta_versions SET lock_version = lock_version + 1 WHERE id = 1;");
    }

    void replaceSubsidyPresetsUnlocked(const Value &presets) {
        exec("DELETE FROM subsidy_preset_levels;");
        exec("DELETE FROM subsidy_presets;");
        if (!presets.isArray()) {
            return;
        }

        for (const auto &preset : presets) {
            if (!preset["id"].isString() || !preset["name"].isString()) {
                continue;
            }
            sqlite3_stmt *stmt = nullptr;
            prepare("INSERT OR REPLACE INTO subsidy_presets(id, name) VALUES(?, ?)", &stmt);
            bindString(stmt, 1, preset["id"].asString());
            bindString(stmt, 2, preset["name"].asString());
            stepDone(stmt);
            sqlite3_finalize(stmt);

            const Value levels = arrayOrEmpty(preset["levels"]);
            for (Json::ArrayIndex index = 0; index < levels.size(); ++index) {
                const auto &level = levels[index];
                if (!level["name"].isString()) {
                    continue;
                }
                prepare(
                    "INSERT INTO subsidy_preset_levels(preset_id, level_index, name, gold) VALUES(?, ?, ?, ?)",
                    &stmt);
                bindString(stmt, 1, preset["id"].asString());
                sqlite3_bind_int(stmt, 2, static_cast<int>(index));
                bindString(stmt, 3, level["name"].asString());
                sqlite3_bind_double(stmt, 4, level["gold"].isNumeric() ? level["gold"].asDouble() : 0);
                stepDone(stmt);
                sqlite3_finalize(stmt);
            }
        }
    }

    void insertTeamUnlocked(const Value &team, int sortOrder) {
        if (!team["id"].isString()) {
            return;
        }

        const std::string teamId = team["id"].asString();
        const Value config = objectOrEmpty(team["config"]);
        const Value reservedSlots = arrayOrEmpty(config["reservedSlots"]);

        sqlite3_stmt *stmt = nullptr;
        prepare(
            "INSERT OR REPLACE INTO teams("
            "id, name, note, week_start, locked, sort_order, reserved_slots_json, subsidy_types_json, member_subsidies_json"
            ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &stmt);
        bindString(stmt, 1, teamId);
        bindString(stmt, 2, team["name"].isString() ? team["name"].asString() : "默认团队");
        bindString(stmt, 3, team["note"].isString() ? team["note"].asString() : "");
        bindOptionalString(stmt, 4, optionalString(team["weekStart"]));
        sqlite3_bind_int(stmt, 5, config["locked"].asBool() ? 1 : 0);
        sqlite3_bind_int(stmt, 6, sortOrder);
        bindString(stmt, 7, writeJson(reservedSlots));
        bindOptionalString(stmt, 8, team["subsidyTypes"].isArray() ? std::optional<std::string>(writeJson(team["subsidyTypes"])) : std::nullopt);
        bindOptionalString(stmt, 9, team["memberSubsidies"].isObject() ? std::optional<std::string>(writeJson(team["memberSubsidies"])) : std::nullopt);
        stepDone(stmt);
        sqlite3_finalize(stmt);

        prepare("DELETE FROM slots WHERE team_id = ?", &stmt);
        bindString(stmt, 1, teamId);
        stepDone(stmt);
        sqlite3_finalize(stmt);

        const Value slots = arrayOrEmpty(team["slots"]);
        for (int index = 0; index < 25; ++index) {
            const Value slot = slots.isValidIndex(index) && slots[index].isObject() ? slots[index] : defaultSlot(index);
            const std::string status = slot["status"].isString() ? slot["status"].asString() : "empty";
            prepare(
                "INSERT OR REPLACE INTO slots("
                "team_id, slot_index, status, member_json, fixed_role, fixed_martial_art_index"
                ") VALUES(?, ?, ?, ?, ?, ?)",
                &stmt);
            bindString(stmt, 1, teamId);
            sqlite3_bind_int(stmt, 2, index);
            bindString(stmt, 3, status);
            bindOptionalString(stmt, 4, slot["member"].isObject() ? std::optional<std::string>(writeJson(slot["member"])) : std::nullopt);
            bindOptionalString(stmt, 5, optionalString(slot["fixedRole"]));
            if (slot["fixedMartialArtIndex"].isInt()) {
                sqlite3_bind_int(stmt, 6, slot["fixedMartialArtIndex"].asInt());
            } else {
                sqlite3_bind_null(stmt, 6);
            }
            stepDone(stmt);
            sqlite3_finalize(stmt);
        }
    }

    void replaceDataUnlocked(const Value &data) {
        exec("DELETE FROM slots;");
        exec("DELETE FROM teams;");
        exec("DELETE FROM archives;");
        exec("DELETE FROM cancellations;");
        exec("DELETE FROM operation_logs;");
        exec("DELETE FROM user_profiles;");

        const Value teams = arrayOrEmpty(data["teams"]);
        for (Json::ArrayIndex index = 0; index < teams.size(); ++index) {
            insertTeamUnlocked(teams[index], static_cast<int>(index));
        }

        const Value archives = arrayOrEmpty(data["archivedTeams"]);
        for (const auto &archive : archives) {
            if (!archive["id"].isString() || !archive["team"].isObject()) {
                continue;
            }
            sqlite3_stmt *stmt = nullptr;
            prepare("INSERT OR REPLACE INTO archives(id, team_json, archived_at, archived_by) VALUES(?, ?, ?, ?)", &stmt);
            bindString(stmt, 1, archive["id"].asString());
            bindString(stmt, 2, writeJson(archive["team"]));
            sqlite3_bind_int64(stmt, 3, jsonInt64(archive["archivedAt"]));
            bindString(stmt, 4, archive["archivedBy"].isString() ? archive["archivedBy"].asString() : "");
            stepDone(stmt);
            sqlite3_finalize(stmt);
        }

        const Value cancellations = arrayOrEmpty(data["cancellations"]);
        for (const auto &item : cancellations) {
            sqlite3_stmt *stmt = nullptr;
            prepare(
                "INSERT OR REPLACE INTO cancellations("
                "qq, reason, cancelled_by, team_id, team_name, slot_index, timestamp"
                ") VALUES(?, ?, ?, ?, ?, ?, ?)",
                &stmt);
            bindString(stmt, 1, item["qq"].isString() ? item["qq"].asString() : "");
            bindString(stmt, 2, item["reason"].isString() ? item["reason"].asString() : "");
            bindString(stmt, 3, item["cancelledBy"].isString() ? item["cancelledBy"].asString() : "");
            bindString(stmt, 4, item["teamId"].isString() ? item["teamId"].asString() : "");
            bindString(stmt, 5, item["teamName"].isString() ? item["teamName"].asString() : "");
            sqlite3_bind_int(stmt, 6, static_cast<int>(jsonInt64(item["slotIndex"])));
            sqlite3_bind_int64(stmt, 7, jsonInt64(item["timestamp"]));
            stepDone(stmt);
            sqlite3_finalize(stmt);
        }

        const Value logs = arrayOrEmpty(data["logs"]);
        for (const auto &log : logs) {
            sqlite3_stmt *stmt = nullptr;
            prepare(
                "INSERT OR REPLACE INTO operation_logs("
                "id, team_id, team_name, timestamp, actor_qq, action"
                ") VALUES(?, ?, ?, ?, ?, ?)",
                &stmt);
            bindString(stmt, 1, log["id"].isString() ? log["id"].asString() : std::to_string(nowMs()));
            bindString(stmt, 2, log["teamId"].isString() ? log["teamId"].asString() : "");
            bindString(stmt, 3, log["teamName"].isString() ? log["teamName"].asString() : "");
            sqlite3_bind_int64(stmt, 4, jsonInt64(log["timestamp"], nowMs()));
            bindString(stmt, 5, log["actorQq"].isString() ? log["actorQq"].asString() : "");
            bindString(stmt, 6, log["action"].isString() ? log["action"].asString() : "");
            stepDone(stmt);
            sqlite3_finalize(stmt);
        }

        const Value profiles = objectOrEmpty(data["userProfiles"]);
        for (const auto &qq : profiles.getMemberNames()) {
            const Value profile = profiles[qq];
            if (!profile["nickname"].isString()) {
                continue;
            }
            sqlite3_stmt *stmt = nullptr;
            prepare("INSERT OR REPLACE INTO user_profiles(qq, nickname) VALUES(?, ?)", &stmt);
            bindString(stmt, 1, qq);
            bindString(stmt, 2, profile["nickname"].asString());
            stepDone(stmt);
            sqlite3_finalize(stmt);
        }

        if (data["subsidyPresets"].isArray()) {
            replaceSubsidyPresetsUnlocked(data["subsidyPresets"]);
        }
    }

    void ensureSchema() {
        if (schemaReady_) {
            return;
        }
        std::ifstream input("backend-cpp/schema.sql");
        if (!input) {
            input.open("schema.sql");
        }
        if (!input) {
            throw std::runtime_error("Cannot open schema.sql");
        }
        std::stringstream buffer;
        buffer << input.rdbuf();
        exec(buffer.str());
        try {
            exec("ALTER TABLE teams ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;");
        } catch (...) {
            // Existing databases created after the split already have this column.
        }
        schemaReady_ = true;
    }

    Value versionsUnlocked() {
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT data_version, lock_version FROM meta_versions WHERE id = 1", &stmt);
        Value json;
        json["ok"] = true;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            json["dataVersion"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 0));
            json["lockVersion"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 1));
        } else {
            json["dataVersion"] = 1;
            json["lockVersion"] = 1;
        }
        sqlite3_finalize(stmt);
        return json;
    }

    Value publicLocksUnlocked() {
        Value json;
        json["slots"] = Value(Json::arrayValue);
        json["teams"] = Value(Json::arrayValue);
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT team_id, slot_index, qq, timestamp FROM slot_locks ORDER BY team_id, slot_index", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value item;
            item["teamId"] = textColumn(stmt, 0);
            item["slotIndex"] = sqlite3_column_int(stmt, 1);
            item["qq"] = textColumn(stmt, 2);
            item["timestamp"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 3));
            json["slots"].append(item);
        }
        sqlite3_finalize(stmt);

        prepare("SELECT team_id, timestamp FROM team_locks ORDER BY team_id", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value item;
            item["teamId"] = textColumn(stmt, 0);
            item["timestamp"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 1));
            json["teams"].append(item);
        }
        sqlite3_finalize(stmt);
        json["lockVersion"] = versionsUnlocked()["lockVersion"];
        return json;
    }

    Value bootstrapUnlocked() {
        Value json = versionsUnlocked();
        json["teams"] = Value(Json::arrayValue);
        json["cancellations"] = Value(Json::arrayValue);
        json["archivedTeams"] = Value(Json::arrayValue);
        json["logs"] = Value(Json::arrayValue);
        json["userProfiles"] = Value(Json::objectValue);
        json["subsidyPresets"] = Value(Json::arrayValue);

        sqlite3_stmt *stmt = nullptr;
        prepare(
            "SELECT id, name, note, week_start, locked, reserved_slots_json, subsidy_types_json, member_subsidies_json "
            "FROM teams ORDER BY sort_order, id",
            &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value team;
            const std::string teamId = textColumn(stmt, 0);
            team["id"] = teamId;
            team["name"] = textColumn(stmt, 1);
            team["note"] = textColumn(stmt, 2);
            if (sqlite3_column_type(stmt, 3) != SQLITE_NULL) {
                team["weekStart"] = textColumn(stmt, 3);
            }
            Value config;
            config["locked"] = sqlite3_column_int(stmt, 4) != 0;
            config["reservedSlots"] = parseJson(textColumn(stmt, 5), Value(Json::arrayValue));
            team["config"] = config;
            if (sqlite3_column_type(stmt, 6) != SQLITE_NULL) {
                team["subsidyTypes"] = parseJson(textColumn(stmt, 6), Value(Json::arrayValue));
            }
            if (sqlite3_column_type(stmt, 7) != SQLITE_NULL) {
                team["memberSubsidies"] = parseJson(textColumn(stmt, 7), Value(Json::objectValue));
            }
            team["slots"] = Value(Json::arrayValue);
            for (int index = 0; index < 25; ++index) {
                team["slots"].append(defaultSlot(index));
            }

            sqlite3_stmt *slotStmt = nullptr;
            prepare(
                "SELECT slot_index, status, member_json, fixed_role, fixed_martial_art_index "
                "FROM slots WHERE team_id = ? ORDER BY slot_index",
                &slotStmt);
            bindString(slotStmt, 1, teamId);
            while (sqlite3_step(slotStmt) == SQLITE_ROW) {
                const int index = sqlite3_column_int(slotStmt, 0);
                if (index < 0 || index >= 25) {
                    continue;
                }
                Value slot;
                slot["index"] = index;
                slot["status"] = textColumn(slotStmt, 1);
                slot["member"] = sqlite3_column_type(slotStmt, 2) == SQLITE_NULL
                    ? Value(Json::nullValue)
                    : parseJson(textColumn(slotStmt, 2), Value(Json::nullValue));
                slot["fixedRole"] = sqlite3_column_type(slotStmt, 3) == SQLITE_NULL
                    ? Value(Json::nullValue)
                    : Value(textColumn(slotStmt, 3));
                if (sqlite3_column_type(slotStmt, 4) == SQLITE_NULL) {
                    slot["fixedMartialArtIndex"] = Value(Json::nullValue);
                } else {
                    slot["fixedMartialArtIndex"] = sqlite3_column_int(slotStmt, 4);
                }
                team["slots"][index] = slot;
            }
            sqlite3_finalize(slotStmt);

            json["teams"].append(team);
        }
        sqlite3_finalize(stmt);

        prepare("SELECT id, team_json, archived_at, archived_by FROM archives ORDER BY archived_at DESC", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value archive;
            archive["id"] = textColumn(stmt, 0);
            archive["team"] = parseJson(textColumn(stmt, 1), Value(Json::objectValue));
            archive["archivedAt"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 2));
            archive["archivedBy"] = textColumn(stmt, 3);
            json["archivedTeams"].append(archive);
        }
        sqlite3_finalize(stmt);

        prepare(
            "SELECT qq, reason, cancelled_by, team_id, team_name, slot_index, timestamp "
            "FROM cancellations ORDER BY timestamp DESC",
            &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value item;
            item["qq"] = textColumn(stmt, 0);
            item["reason"] = textColumn(stmt, 1);
            item["cancelledBy"] = textColumn(stmt, 2);
            item["teamId"] = textColumn(stmt, 3);
            item["teamName"] = textColumn(stmt, 4);
            item["slotIndex"] = sqlite3_column_int(stmt, 5);
            item["timestamp"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 6));
            json["cancellations"].append(item);
        }
        sqlite3_finalize(stmt);

        prepare("SELECT id, team_id, team_name, timestamp, actor_qq, action FROM operation_logs ORDER BY timestamp", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value log;
            log["id"] = textColumn(stmt, 0);
            log["teamId"] = textColumn(stmt, 1);
            log["teamName"] = textColumn(stmt, 2);
            log["timestamp"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 3));
            log["actorQq"] = textColumn(stmt, 4);
            log["action"] = textColumn(stmt, 5);
            json["logs"].append(log);
        }
        sqlite3_finalize(stmt);

        prepare("SELECT qq, nickname FROM user_profiles ORDER BY qq", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value profile;
            profile["nickname"] = textColumn(stmt, 1);
            json["userProfiles"][textColumn(stmt, 0)] = profile;
        }
        sqlite3_finalize(stmt);

        prepare("SELECT id, name FROM subsidy_presets ORDER BY id", &stmt);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            Value preset;
            const std::string presetId = textColumn(stmt, 0);
            preset["id"] = presetId;
            preset["name"] = textColumn(stmt, 1);
            preset["levels"] = Value(Json::arrayValue);

            sqlite3_stmt *levelStmt = nullptr;
            prepare("SELECT name, gold FROM subsidy_preset_levels WHERE preset_id = ? ORDER BY level_index", &levelStmt);
            bindString(levelStmt, 1, presetId);
            while (sqlite3_step(levelStmt) == SQLITE_ROW) {
                Value level;
                level["name"] = textColumn(levelStmt, 0);
                level["gold"] = sqlite3_column_double(levelStmt, 1);
                preset["levels"].append(level);
            }
            sqlite3_finalize(levelStmt);
            json["subsidyPresets"].append(preset);
        }
        sqlite3_finalize(stmt);

        Value locks = publicLocksUnlocked();
        json["locks"] = locks["slots"];
        json["teamLocks"] = locks["teams"];
        return json;
    }
};

Value errorJson(const std::string &message) {
    Value json;
    json["ok"] = false;
    json["error"] = message;
    return json;
}

long long toInt64(const Value &value, long long fallback) {
    if (value.isInt64()) return value.asInt64();
    if (value.isInt()) return value.asInt();
    if (value.isString()) {
        try {
            return std::stoll(value.asString());
        } catch (...) {
            return fallback;
        }
    }
    return fallback;
}

std::optional<long long> optionalInt64(const Value &value) {
    if (value.isNull()) return std::nullopt;
    return toInt64(value);
}

std::optional<long long> optionalQueryInt64(const std::string &value) {
    if (value.empty()) {
        return std::nullopt;
    }
    try {
        return std::stoll(value);
    } catch (...) {
        return std::nullopt;
    }
}

std::optional<std::string> optionalBodyString(const Value &value) {
    if (value.isString()) {
        return value.asString();
    }
    return std::nullopt;
}

drogon::HttpStatusCode statusForResult(const Value &json) {
    if (json["ok"].asBool()) {
        return drogon::k200OK;
    }
    const std::string reason = json["reason"].isString() ? json["reason"].asString() : "";
    if (reason == "teamLocked" || reason == "expired" || reason == "slotChanged") {
        return drogon::k409Conflict;
    }
    if (reason == "notFound") {
        return drogon::k404NotFound;
    }
    return drogon::k400BadRequest;
}

HttpResponsePtr jsonResponse(const Value &json, drogon::HttpStatusCode status = drogon::k200OK) {
    auto response = drogon::HttpResponse::newHttpJsonResponse(json);
    response->setStatusCode(status);
    return response;
}

} // namespace

int main() {
    const auto port = std::getenv("PORT") != nullptr ? std::atoi(std::getenv("PORT")) : 23219;
    const std::filesystem::path dbPath = std::getenv("TEAMASSISTANT_DB") != nullptr
        ? std::getenv("TEAMASSISTANT_DB")
        : "backend-cpp/data/teamassistant.sqlite3";

    auto db = std::make_shared<SqliteDb>(dbPath);

    drogon::app().registerHandler("/api/v2/version",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            callback(jsonResponse(db->versions()));
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/bootstrap",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            callback(jsonResponse(db->bootstrap()));
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/data",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing data"), drogon::k400BadRequest));
                return;
            }
            try {
                callback(jsonResponse(db->replaceData(*json)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/sync",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto dataVersion = request->getParameter("dataVersion");
            const auto lockVersion = request->getParameter("lockVersion");
            callback(jsonResponse(db->sync(optionalQueryInt64(dataVersion), optionalQueryInt64(lockVersion))));
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/events",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            auto response = drogon::HttpResponse::newHttpResponse();
            response->setContentTypeCode(drogon::CT_TEXT_PLAIN);
            response->addHeader("Content-Type", "text/event-stream; charset=utf-8");
            response->addHeader("Cache-Control", "no-cache, no-transform");
            Json::StreamWriterBuilder builder;
            const auto body = std::string("event: hello\ndata: ") + Json::writeString(builder, db->versions()) + "\n\n";
            response->setBody(body);
            callback(response);
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/locks",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            callback(jsonResponse(db->publicLocks()));
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/slot-locks",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["teamId"].isString() || !(*json)["qq"].isString()) {
                callback(jsonResponse(errorJson("Missing fields"), drogon::k400BadRequest));
                return;
            }
            try {
                callback(jsonResponse(db->acquireSlotLock(
                    (*json)["teamId"].asString(),
                    static_cast<int>(toInt64((*json)["slotIndex"])),
                    (*json)["qq"].asString())));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/slot-locks/{1}/{2}",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId, int slotIndex) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["qq"].isString()) {
                callback(jsonResponse(errorJson("Missing fields"), drogon::k400BadRequest));
                return;
            }
            try {
                db->releaseSlotLock(teamId, slotIndex, (*json)["qq"].asString(), optionalInt64((*json)["lockToken"]));
                Value ok;
                ok["ok"] = true;
                callback(jsonResponse(ok));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/slot-locks/validate",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["teamId"].isString() || !(*json)["qq"].isString()) {
                callback(jsonResponse(errorJson("Missing fields"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->validateSlotLock(
                    (*json)["teamId"].asString(),
                    static_cast<int>(toInt64((*json)["slotIndex"])),
                    (*json)["qq"].asString(),
                    toInt64((*json)["lockToken"]));
                callback(jsonResponse(result, statusForResult(result)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/teams/{1}/slots/{2}/member",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId, int slotIndex) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["member"].isObject()) {
                callback(jsonResponse(errorJson("Missing member update"), drogon::k400BadRequest));
                return;
            }
            const std::string actorQq = (*json)["actorQq"].isString()
                ? (*json)["actorQq"].asString()
                : ((*json)["qq"].isString() ? (*json)["qq"].asString() : "");
            try {
                const auto result = db->saveSlotMember(
                    teamId,
                    slotIndex,
                    actorQq,
                    (*json)["member"],
                    toInt64((*json)["lockToken"]),
                    optionalBodyString((*json)["expectedMemberQq"]));
                callback(jsonResponse(result, statusForResult(result)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/teams/{1}/slots/{2}/member",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId, int slotIndex) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing member update"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->leaveSlotMember(
                    teamId,
                    slotIndex,
                    (*json)["actorQq"].isString() ? (*json)["actorQq"].asString() : "",
                    toInt64((*json)["lockToken"]),
                    optionalBodyString((*json)["expectedMemberQq"]));
                callback(jsonResponse(result, statusForResult(result)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/teams/{1}/slots/{2}/cancel",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId, int slotIndex) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing cancellation"), drogon::k400BadRequest));
                return;
            }
            const std::string actorQq = (*json)["actorQq"].isString() ? (*json)["actorQq"].asString() : "";
            const std::string cancelledBy = (*json)["cancelledBy"].isString() ? (*json)["cancelledBy"].asString() : actorQq;
            try {
                const auto result = db->cancelSlotMember(
                    teamId,
                    slotIndex,
                    actorQq,
                    cancelledBy,
                    (*json)["reason"].isString() ? (*json)["reason"].asString() : "",
                    toInt64((*json)["lockToken"]),
                    optionalBodyString((*json)["expectedMemberQq"]));
                callback(jsonResponse(result, statusForResult(result)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/team-locks",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["teamId"].isString()) {
                callback(jsonResponse(errorJson("Missing teamId"), drogon::k400BadRequest));
                return;
            }
            try {
                callback(jsonResponse(db->setTeamLock((*json)["teamId"].asString())));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/team-locks/{1}",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            try {
                callback(jsonResponse(db->removeTeamLock(teamId)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/subsidy-presets",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            try {
                callback(jsonResponse(db->subsidyPresets()));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/subsidy-presets",
        [db](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing presets"), drogon::k400BadRequest));
                return;
            }
            try {
                callback(jsonResponse(db->updateSubsidyPresets((*json)["presets"])));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/{path}",
        [](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            Value json;
            json["ok"] = false;
            json["error"] = "API v2 endpoint is scaffolded but not implemented yet";
            callback(jsonResponse(json, drogon::k501NotImplemented));
        },
        {drogon::Get, drogon::Post, drogon::Put, drogon::Patch, drogon::Delete});

    drogon::app()
        .setLogPath("./")
        .setLogLevel(trantor::Logger::kWarn)
        .addListener("0.0.0.0", port)
        .setThreadNum(std::max(2u, std::thread::hardware_concurrency()))
        .run();
}
