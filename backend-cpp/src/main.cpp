#include <drogon/drogon.h>
#include <sqlite3.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cctype>
#include <filesystem>
#include <functional>
#include <fstream>
#include <iomanip>
#include <memory>
#include <mutex>
#include <optional>
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <ctime>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <zlib.h>

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

struct SlotLockRecord {
    std::string teamId;
    int slotIndex = 0;
    std::string qq;
    long long timestamp = 0;
};

struct BackupEntry {
    std::string name;
    std::string createdAt;
    std::uintmax_t size = 0;
};

class VersionEventHub {
public:
    int subscribe(drogon::ResponseStreamPtr stream, const Value &initialVersion) {
        int id = 0;
        auto sharedStream = std::shared_ptr<drogon::ResponseStream>{std::move(stream)};
        {
            std::lock_guard lock(mutex_);
            id = nextId_++;
            streams_[id] = sharedStream;
        }
        sendTo(id, "hello", initialVersion);
        return id;
    }

    void publish(const Value &version, const std::string &type = "version") {
        std::vector<std::pair<int, std::shared_ptr<drogon::ResponseStream>>> streams;
        {
            std::lock_guard lock(mutex_);
            streams.reserve(streams_.size());
            for (const auto &[id, stream] : streams_) {
                streams.emplace_back(id, stream);
            }
        }

        std::vector<int> stale;
        for (const auto &[id, stream] : streams) {
            if (!send(stream, type, version)) {
                stale.push_back(id);
            }
        }

        if (!stale.empty()) {
            std::lock_guard lock(mutex_);
            for (int id : stale) {
                streams_.erase(id);
            }
        }
    }

    void heartbeat() {
        publishRaw(": keep-alive\n\n");
    }

private:
    std::mutex mutex_;
    int nextId_ = 1;
    std::unordered_map<int, std::shared_ptr<drogon::ResponseStream>> streams_;

    static std::string eventPayload(const std::string &event, const Value &data) {
        Json::StreamWriterBuilder builder;
        builder["indentation"] = "";
        Value payload = data;
        if (!payload["type"].isString()) {
            payload["type"] = event;
        }
        return "event: " + event + "\ndata: " + Json::writeString(builder, payload) + "\n\n";
    }

    static bool send(const std::shared_ptr<drogon::ResponseStream> &stream, const std::string &event, const Value &data) {
        return stream && stream->send(eventPayload(event, data));
    }

    void publishRaw(const std::string &payload) {
        std::vector<std::pair<int, std::shared_ptr<drogon::ResponseStream>>> streams;
        {
            std::lock_guard lock(mutex_);
            streams.reserve(streams_.size());
            for (const auto &[id, stream] : streams_) {
                streams.emplace_back(id, stream);
            }
        }

        std::vector<int> stale;
        for (const auto &[id, stream] : streams) {
            if (!stream || !stream->send(payload)) {
                stale.push_back(id);
            }
        }

        if (!stale.empty()) {
            std::lock_guard lock(mutex_);
            for (int id : stale) {
                streams_.erase(id);
            }
        }
    }

    void sendTo(int id, const std::string &event, const Value &data) {
        std::shared_ptr<drogon::ResponseStream> stream;
        {
            std::lock_guard lock(mutex_);
            const auto iterator = streams_.find(id);
            if (iterator == streams_.end()) {
                return;
            }
            stream = iterator->second;
        }
        if (send(stream, event, data)) {
            return;
        }
        std::lock_guard lock(mutex_);
        streams_.erase(id);
    }
};

class SqliteDb {
public:
    explicit SqliteDb(const std::filesystem::path &path) {
        dbPath_ = path;
        dataDir_ = path.parent_path();
        backupDir_ = dataDir_ / "backups";
        std::filesystem::create_directories(path.parent_path());
        if (sqlite3_open(path.string().c_str(), &db_) != SQLITE_OK) {
            throw std::runtime_error(sqlite3_errmsg(db_));
        }
        exec("PRAGMA journal_mode=WAL;");
        exec("PRAGMA synchronous=NORMAL;");
        exec("PRAGMA foreign_keys=ON;");
        exec("PRAGMA busy_timeout=3000;");
        exec("PRAGMA temp_store=MEMORY;");
        exec("PRAGMA wal_autocheckpoint=1000;");
        exec("PRAGMA cache_size=-20000;");
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
        prepare("SELECT data_version FROM meta_versions WHERE id = 1", &stmt);
        Value json;
        json["ok"] = true;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            json["dataVersion"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 0));
        } else {
            json["dataVersion"] = 1;
        }
        json["lockVersion"] = static_cast<Json::Int64>(lockVersion_);
        sqlite3_finalize(stmt);
        return json;
    }

    Value replaceData(const Value &data) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        exec("BEGIN IMMEDIATE;");
        try {
            replaceDataUnlocked(data);
            slotLocks_.clear();
            teamLocks_.clear();
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
        cleanExpiredLocksUnlocked();
        return publicLocksUnlocked();
    }

    bool expireRuntimeLocks() {
        std::lock_guard lock(mutex_);
        return cleanExpiredLocksUnlocked();
    }

    Value bootstrap() {
        std::lock_guard lock(mutex_);
        ensureSchema();
        cleanExpiredLocksUnlocked();
        return bootstrapUnlocked();
    }

    Value sync(std::optional<long long> dataVersion, std::optional<long long> lockVersion) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        cleanExpiredLocksUnlocked();
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
        const auto now = nowMs();
        cleanExpiredLocksUnlocked(now);

        const auto teamLock = teamLocks_.find(teamId);
        if (teamLock != teamLocks_.end()) {
            Value conflict = conflictJson("teamLocked");
            conflict["lockedAt"] = static_cast<Json::Int64>(teamLock->second);
            return conflict;
        }

        const std::string key = slotLockKey(teamId, slotIndex);
        const auto existing = slotLocks_.find(key);
        if (existing != slotLocks_.end() && existing->second.qq != qq && now - existing->second.timestamp < lockTimeoutMs_) {
            Value conflict;
            conflict["ok"] = false;
            conflict["lockedBy"] = existing->second.qq;
            conflict["lockedAt"] = static_cast<Json::Int64>(existing->second.timestamp);
            return conflict;
        }

        slotLocks_[key] = SlotLockRecord{teamId, slotIndex, qq, now};
        bumpLockVersionUnlocked();

        Value ok;
        ok["ok"] = true;
        ok["timestamp"] = static_cast<Json::Int64>(now);
        ok["lockToken"] = static_cast<Json::Int64>(now);
        ok["lockVersion"] = static_cast<Json::Int64>(lockVersion_);
        return ok;
    }

    Value validateSlotLock(const std::string &teamId, int slotIndex, const std::string &qq, long long lockToken) {
        std::lock_guard lock(mutex_);
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
        const std::string key = slotLockKey(teamId, slotIndex);
        const auto existing = slotLocks_.find(key);
        if (
            existing != slotLocks_.end() &&
            existing->second.qq == qq &&
            (!lockToken.has_value() || existing->second.timestamp == *lockToken)
        ) {
            slotLocks_.erase(existing);
            bumpLockVersionUnlocked();
        }
    }

    Value setTeamLock(const std::string &teamId) {
        std::lock_guard lock(mutex_);
        const auto now = nowMs();
        teamLocks_[teamId] = now;
        bumpLockVersionUnlocked();
        Value result;
        result["ok"] = true;
        result["lockVersion"] = static_cast<Json::Int64>(lockVersion_);
        result["timestamp"] = static_cast<Json::Int64>(now);
        return result;
    }

    Value removeTeamLock(const std::string &teamId) {
        std::lock_guard lock(mutex_);
        if (teamLocks_.erase(teamId) > 0) {
            bumpLockVersionUnlocked();
        }
        Value result;
        result["ok"] = true;
        result["lockVersion"] = static_cast<Json::Int64>(lockVersion_);
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

    Value updateUserProfile(const std::string &qq, const std::string &rawNickname) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const std::string nickname = normalizeNickname(rawNickname);
        if (qq.empty() || nickname.empty()) {
            return errorJson("Missing fields");
        }

        const auto now = nowMs();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            std::string previous;
            sqlite3_stmt *stmt = nullptr;
            prepare("SELECT nickname FROM user_profiles WHERE qq = ?", &stmt);
            bindString(stmt, 1, qq);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                previous = textColumn(stmt, 0);
            }
            sqlite3_finalize(stmt);

            prepare("INSERT INTO user_profiles(qq, nickname) VALUES(?, ?) "
                    "ON CONFLICT(qq) DO UPDATE SET nickname = excluded.nickname",
                    &stmt);
            bindString(stmt, 1, qq);
            bindString(stmt, 2, nickname);
            stepDone(stmt);
            sqlite3_finalize(stmt);

            const std::string action = previous.empty()
                ? "设置昵称：" + nickname
                : "修改昵称：" + previous + " -> " + nickname;
            insertLogUnlocked("", "", now, qq, action);
            bumpDataVersionUnlocked();

            result = versionsUnlocked();
            result["ok"] = true;
            Value patch;
            patch["type"] = "updateNickname";
            patch["qq"] = qq;
            patch["profile"]["nickname"] = nickname;
            result["patch"] = patch;
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value createTeam(const Value &team) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        if (!team.isObject() || !team["id"].isString() || team["id"].asString().empty()) {
            return errorJson("Missing team");
        }

        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            insertTeamUnlocked(normalizeTeam(team, "默认团队"), nextTeamSortOrderUnlocked());
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value deleteTeam(const std::string &teamId, const Value &fallbackTeam) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare("DELETE FROM teams WHERE id = ?", &stmt);
            bindString(stmt, 1, teamId);
            stepDone(stmt);
            const bool deleted = sqlite3_changes(db_) > 0;
            sqlite3_finalize(stmt);
            if (!deleted) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            if (teamCountUnlocked() == 0 && fallbackTeam.isObject()) {
                insertTeamUnlocked(normalizeTeam(fallbackTeam, "默认团队"), 0);
            }
            clearRuntimeLocksForTeamUnlocked(teamId);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value archiveTeam(const std::string &teamId, const std::string &archivedBy, long long archivedAt, const Value &fallbackTeam) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        if (archivedAt <= 0) {
            archivedAt = nowMs();
        }

        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value team = readTeamUnlocked(teamId);
            if (!team.isObject()) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            const std::string archiveId = teamId + "-" + std::to_string(archivedAt);
            sqlite3_stmt *stmt = nullptr;
            prepare("INSERT OR REPLACE INTO archives(id, team_json, archived_at, archived_by) VALUES(?, ?, ?, ?)", &stmt);
            bindString(stmt, 1, archiveId);
            bindString(stmt, 2, writeJson(team));
            sqlite3_bind_int64(stmt, 3, archivedAt);
            bindString(stmt, 4, archivedBy);
            stepDone(stmt);
            sqlite3_finalize(stmt);

            insertLogUnlocked(teamId, team["name"].asString(), archivedAt, archivedBy, "归档表格");

            prepare("DELETE FROM teams WHERE id = ?", &stmt);
            bindString(stmt, 1, teamId);
            stepDone(stmt);
            sqlite3_finalize(stmt);

            if (teamCountUnlocked() == 0 && fallbackTeam.isObject()) {
                insertTeamUnlocked(normalizeTeam(fallbackTeam, "默认团队"), 0);
            }
            clearRuntimeLocksForTeamUnlocked(teamId);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value restoreArchive(const std::string &archiveId, const std::string &actorQq, long long restoredAt) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        if (restoredAt <= 0) {
            restoredAt = nowMs();
        }

        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare("SELECT team_json FROM archives WHERE id = ?", &stmt);
            bindString(stmt, 1, archiveId);
            Value team(Json::nullValue);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                team = normalizeTeam(parseJson(textColumn(stmt, 0), Value(Json::objectValue)), "默认团队");
            }
            sqlite3_finalize(stmt);
            if (!team.isObject() || !team["id"].isString()) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            insertTeamUnlocked(team, nextTeamSortOrderUnlocked());

            prepare("DELETE FROM archives WHERE id = ?", &stmt);
            bindString(stmt, 1, archiveId);
            stepDone(stmt);
            sqlite3_finalize(stmt);

            insertLogUnlocked(team["id"].asString(), team["name"].asString(), restoredAt, actorQq, "恢复表格");
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value patchTeam(const std::string &teamId, const Value &body) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            if (body.isMember("name")) {
                const std::string current = readTeamNameUnlocked(teamId);
                const std::string name = normalizeTeamName(body["name"].isString() ? body["name"].asString() : "", current);
                prepare("UPDATE teams SET name = ? WHERE id = ?", &stmt);
                bindString(stmt, 1, name);
                bindString(stmt, 2, teamId);
                stepDone(stmt);
                sqlite3_finalize(stmt);
            }
            if (body.isMember("weekStart")) {
                const std::string weekStart = body["weekStart"].isString() ? body["weekStart"].asString() : "";
                prepare("UPDATE teams SET week_start = ? WHERE id = ?", &stmt);
                bindString(stmt, 1, weekStart);
                bindString(stmt, 2, teamId);
                stepDone(stmt);
                sqlite3_finalize(stmt);
            }
            if (body.isMember("note")) {
                prepare("UPDATE teams SET note = ? WHERE id = ?", &stmt);
                bindString(stmt, 1, body["note"].isString() ? body["note"].asString() : "");
                bindString(stmt, 2, teamId);
                stepDone(stmt);
                sqlite3_finalize(stmt);
            }
            if (!teamExistsUnlocked(teamId)) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value reorderTeams(const Value &ids) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        if (!ids.isArray()) {
            return errorJson("Missing ids");
        }
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            int order = 0;
            sqlite3_stmt *stmt = nullptr;
            for (const auto &id : ids) {
                if (!id.isString()) {
                    continue;
                }
                prepare("UPDATE teams SET sort_order = ? WHERE id = ?", &stmt);
                sqlite3_bind_int(stmt, 1, order++);
                bindString(stmt, 2, id.asString());
                stepDone(stmt);
                sqlite3_finalize(stmt);
            }
            prepare("UPDATE teams SET sort_order = sort_order + ? WHERE id NOT IN (SELECT value FROM json_each(?))", &stmt);
            sqlite3_bind_int(stmt, 1, order);
            bindString(stmt, 2, writeJson(ids));
            stepDone(stmt);
            sqlite3_finalize(stmt);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value setTeamConfigLock(const std::string &teamId, bool locked) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare("UPDATE teams SET locked = ? WHERE id = ?", &stmt);
            sqlite3_bind_int(stmt, 1, locked ? 1 : 0);
            bindString(stmt, 2, teamId);
            stepDone(stmt);
            const bool changed = sqlite3_changes(db_) > 0;
            sqlite3_finalize(stmt);
            if (!changed) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value setSlotRole(
        const std::string &teamId,
        int slotIndex,
        const Value &role,
        const Value &martialArtIndex,
        const std::string &assignQq,
        const std::string &actorQq
    ) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value team = readTeamUnlocked(teamId);
            if (!team.isObject() || slotIndex < 0 || slotIndex >= 25) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            Value &slot = team["slots"][slotIndex];
            Value reserved = arrayOrEmpty(team["config"]["reservedSlots"]);
            const std::string roleText = role.isString() ? role.asString() : "";

            if (roleText == "boss") {
                reserved = addReservedSlot(reserved, slotIndex);
                slot = defaultSlot(slotIndex);
                slot["status"] = "reserved";
            } else {
                reserved = removeReservedSlot(reserved, slotIndex);
                if (role.isNull()) {
                    slot = defaultSlot(slotIndex);
                } else if (!assignQq.empty() && martialArtIndex.isInt()) {
                    slot = defaultSlot(slotIndex);
                    slot["status"] = "occupied";
                    Value member;
                    member["qq"] = assignQq;
                    member["martialArtIndex"] = std::to_string(martialArtIndex.asInt());
                    member["gearScore"] = "";
                    member["characterId"] = "";
                    member["note"] = "";
                    slot["member"] = member;
                    insertLogUnlocked(teamId, team["name"].asString(), nowMs(), actorQq.empty() ? assignQq : actorQq,
                                      "指定 #" + std::to_string(slotIndex + 1) + " 报名：" + assignQq);
                } else {
                    slot = defaultSlot(slotIndex);
                    slot["status"] = "fixed";
                    slot["fixedRole"] = roleText;
                    slot["fixedMartialArtIndex"] = martialArtIndex.isInt() ? Value(martialArtIndex.asInt()) : Value(Json::nullValue);
                }
            }

            team["config"]["reservedSlots"] = reserved;
            updateTeamFromJsonUnlocked(team);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value quickReserve(const std::string &teamId, const std::string &reserveType, int count) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value team = readTeamUnlocked(teamId);
            if (!team.isObject()) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            Value reserved = arrayOrEmpty(team["config"]["reservedSlots"]);
            Value order = quickReserveOrder(reserveType, static_cast<int>(team["slots"].size()));
            int current = 0;
            if (reserveType == "boss") {
                current = static_cast<int>(reserved.size());
            } else {
                for (const auto &slot : team["slots"]) {
                    if (slot["status"].asString() == "fixed" && slot["fixedRole"].asString() == reserveType) {
                        current += 1;
                    }
                }
            }

            if (reserveType == "boss") {
                if (count < current) {
                    std::unordered_set<int> remove;
                    for (Json::ArrayIndex index = static_cast<Json::ArrayIndex>(std::max(0, count)); index < reserved.size(); ++index) {
                        remove.insert(reserved[index].asInt());
                    }
                    Value nextReserved(Json::arrayValue);
                    for (const auto &slotIndex : reserved) {
                        if (!remove.contains(slotIndex.asInt())) {
                            nextReserved.append(slotIndex);
                        }
                    }
                    for (int slotIndex : remove) {
                        if (slotIndex >= 0 && team["slots"].isValidIndex(slotIndex)) {
                            team["slots"][slotIndex] = defaultSlot(slotIndex);
                        }
                    }
                    reserved = nextReserved;
                } else {
                    int need = count - current;
                    for (Json::ArrayIndex index = 0; index < team["slots"].size() && need > 0; ++index) {
                        Value &slot = team["slots"][index];
                        if (slot["status"].asString() == "empty" && !reservedContains(reserved, static_cast<int>(index))) {
                            reserved.append(static_cast<int>(index));
                            slot = defaultSlot(static_cast<int>(index));
                            slot["status"] = "reserved";
                            need -= 1;
                        }
                    }
                }
            } else if (count < current) {
                std::unordered_map<int, int> rank;
                for (Json::ArrayIndex index = 0; index < order.size(); ++index) {
                    rank[order[index].asInt()] = static_cast<int>(index);
                }
                std::vector<int> fixedSlots;
                for (Json::ArrayIndex index = 0; index < team["slots"].size(); ++index) {
                    const Value &slot = team["slots"][index];
                    if (slot["status"].asString() == "fixed" && slot["fixedRole"].asString() == reserveType) {
                        fixedSlots.push_back(static_cast<int>(index));
                    }
                }
                std::sort(fixedSlots.begin(), fixedSlots.end(), [&rank](int left, int right) {
                    const int leftRank = rank.contains(left) ? rank[left] : left;
                    const int rightRank = rank.contains(right) ? rank[right] : right;
                    return leftRank < rightRank;
                });
                for (std::size_t index = static_cast<std::size_t>(std::max(0, count)); index < fixedSlots.size(); ++index) {
                    team["slots"][fixedSlots[index]] = defaultSlot(fixedSlots[index]);
                }
            } else {
                int need = count - current;
                for (const auto &slotIndexValue : order) {
                    if (need <= 0) {
                        break;
                    }
                    const int slotIndex = slotIndexValue.asInt();
                    Value &slot = team["slots"][slotIndex];
                    if (slot["status"].asString() == "empty" && !reservedContains(reserved, slotIndex)) {
                        slot = defaultSlot(slotIndex);
                        slot["status"] = "fixed";
                        slot["fixedRole"] = reserveType;
                        need -= 1;
                    }
                }
            }

            team["config"]["reservedSlots"] = sortUniqueIntArray(reserved);
            updateTeamFromJsonUnlocked(team);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value dismissCancellation(const std::string &qq, long long timestamp) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            sqlite3_stmt *stmt = nullptr;
            prepare("DELETE FROM cancellations WHERE qq = ? AND timestamp = ?", &stmt);
            bindString(stmt, 1, qq);
            sqlite3_bind_int64(stmt, 2, timestamp);
            stepDone(stmt);
            sqlite3_finalize(stmt);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value updateTeamSubsidyTypes(const std::string &teamId, const Value &subsidyTypes) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value team = readTeamUnlocked(teamId);
            if (!team.isObject()) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }
            team["subsidyTypes"] = normalizeSubsidyTypes(subsidyTypes);
            cleanMemberSubsidiesForTypes(team);
            updateTeamFromJsonUnlocked(team);
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value registerMemberSubsidies(
        const std::optional<std::string> &teamId,
        const std::optional<std::string> &archiveId,
        const std::string &qq,
        const Value &selections,
        const std::string &weekStart
    ) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        if (qq.empty()) {
            return errorJson("Missing qq");
        }
        Value result;
        exec("BEGIN IMMEDIATE;");
        try {
            Value team;
            if (archiveId.has_value()) {
                team = readArchivedTeamUnlocked(*archiveId);
            } else if (teamId.has_value()) {
                team = readTeamUnlocked(*teamId);
            }
            if (!team.isObject()) {
                exec("ROLLBACK;");
                return conflictJson("notFound");
            }

            Value memberSubsidies = objectOrEmpty(team["memberSubsidies"]);
            Value existing = arrayOrEmpty(memberSubsidies[qq]);
            Value normalized = normalizeMemberSubsidySelections(selections, weekStart);
            if (!weekStart.empty()) {
                Value nextSelections(Json::arrayValue);
                for (const auto &selection : existing) {
                    if (selection["weekStart"].isString() && selection["weekStart"].asString() != weekStart) {
                        nextSelections.append(selection);
                    }
                }
                for (const auto &selection : normalized) {
                    nextSelections.append(selection);
                }
                memberSubsidies[qq] = nextSelections;
            } else {
                memberSubsidies[qq] = normalized;
            }
            team["memberSubsidies"] = memberSubsidies;

            if (archiveId.has_value()) {
                updateArchivedTeamUnlocked(*archiveId, team);
            } else {
                updateTeamFromJsonUnlocked(team);
            }
            insertLogUnlocked(team["id"].asString(), team["name"].asString(), nowMs(), qq, "登记补贴");
            bumpDataVersionUnlocked();
            result = mutationVersionsUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }
        return result;
    }

    Value backups() {
        std::lock_guard lock(mutex_);
        Value result;
        result["ok"] = true;
        result["backups"] = backupEntriesJson(listBackupsUnlocked());
        return result;
    }

    Value createBackup() {
        std::lock_guard lock(mutex_);
        ensureSchema();
        std::filesystem::create_directories(backupDir_);
        Value payload = backupPayloadUnlocked();
        const std::string createdAt = shanghaiTimestamp(nowMs());
        const std::string name = "teamassistant-" + backupFileTimestamp(nowMs()) + ".json.gz";
        const auto path = backupDir_ / name;
        writeGzipFile(path, writeJson(payload));

        Value result;
        result["ok"] = true;
        result["name"] = name;
        result["backups"] = backupEntriesJson(listBackupsUnlocked());
        return result;
    }

    Value restoreBackup(const std::string &name) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        const auto path = resolveBackupPath(name);
        if (!std::filesystem::exists(path)) {
            return conflictJson("notFound");
        }
        Value payload = parseJson(readMaybeGzipFile(path), Value(Json::objectValue));
        Value data = backupDataFromPayload(payload);
        if (!data.isObject()) {
            return errorJson("Invalid backup");
        }

        exec("BEGIN IMMEDIATE;");
        try {
            replaceDataUnlocked(data);
            slotLocks_.clear();
            teamLocks_.clear();
            bumpDataVersionUnlocked();
            bumpLockVersionUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }

        Value snapshot = bootstrapUnlocked();
        snapshot["ok"] = true;
        Value result;
        result["ok"] = true;
        result["name"] = name;
        result["data"] = snapshot;
        result["backups"] = backupEntriesJson(listBackupsUnlocked());
        return result;
    }

    Value deleteBackup(const std::string &name) {
        std::lock_guard lock(mutex_);
        const auto path = resolveBackupPath(name);
        if (std::filesystem::exists(path)) {
            std::filesystem::remove(path);
        }
        Value result;
        result["ok"] = true;
        result["backups"] = backupEntriesJson(listBackupsUnlocked());
        return result;
    }

    std::optional<std::filesystem::path> backupDownloadPath(const std::string &name) {
        std::lock_guard lock(mutex_);
        const auto path = resolveBackupPath(name);
        if (!std::filesystem::exists(path) || !std::filesystem::is_regular_file(path)) {
            return std::nullopt;
        }
        return path;
    }

    Value importBackup(const std::string &body) {
        std::lock_guard lock(mutex_);
        ensureSchema();
        Value payload = parseJson(gzipInflate(body).value_or(body), Value(Json::objectValue));
        Value data = backupDataFromPayload(payload);
        if (!data.isObject()) {
            return errorJson("Invalid backup");
        }

        exec("BEGIN IMMEDIATE;");
        try {
            replaceDataUnlocked(data);
            slotLocks_.clear();
            teamLocks_.clear();
            bumpDataVersionUnlocked();
            bumpLockVersionUnlocked();
            exec("COMMIT;");
        } catch (...) {
            exec("ROLLBACK;");
            throw;
        }

        Value snapshot = bootstrapUnlocked();
        snapshot["ok"] = true;
        Value result;
        result["ok"] = true;
        result["name"] = Value(Json::nullValue);
        result["data"] = snapshot;
        result["backups"] = backupEntriesJson(listBackupsUnlocked());
        return result;
    }

private:
    sqlite3 *db_ = nullptr;
    std::mutex mutex_;
    std::filesystem::path dbPath_;
    std::filesystem::path dataDir_;
    std::filesystem::path backupDir_;
    bool schemaReady_ = false;
    const long long lockTimeoutMs_ = 30'000;
    long long lockVersion_ = 1;
    std::unordered_map<std::string, SlotLockRecord> slotLocks_;
    std::unordered_map<std::string, long long> teamLocks_;

    static long long nowMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
    }

    static std::string slotLockKey(const std::string &teamId, int slotIndex) {
        return teamId + ":" + std::to_string(slotIndex);
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

    static int jsonInt(const Value &value, int fallback = 0) {
        return static_cast<int>(toInt64(value, fallback));
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

    static Value normalizeSubsidyTypes(const Value &subsidyTypes) {
        Value normalized(Json::arrayValue);
        if (!subsidyTypes.isArray()) {
            return normalized;
        }
        for (const auto &type : subsidyTypes) {
            if (!type.isObject()) {
                continue;
            }
            Value item;
            item["id"] = type["id"].isString() ? type["id"].asString() : "";
            item["name"] = type["name"].isString() ? type["name"].asString() : "";
            item["levels"] = Value(Json::arrayValue);
            for (const auto &level : arrayOrEmpty(type["levels"])) {
                if (!level.isObject()) {
                    continue;
                }
                Value normalizedLevel;
                normalizedLevel["name"] = level["name"].isString() ? level["name"].asString() : "";
                normalizedLevel["gold"] = level["gold"].isNumeric() ? std::max(0.0, level["gold"].asDouble()) : 0.0;
                item["levels"].append(normalizedLevel);
            }
            normalized.append(item);
        }
        return normalized;
    }

    static Value normalizeMemberSubsidySelections(const Value &selections, const std::string &weekStart = "") {
        Value normalized(Json::arrayValue);
        if (!selections.isArray()) {
            return normalized;
        }
        for (const auto &selection : selections) {
            if (!selection.isObject()) {
                continue;
            }
            Value item;
            item["typeId"] = selection["typeId"].isString() ? selection["typeId"].asString() : "";
            item["levelName"] = selection["levelName"].isString() ? selection["levelName"].asString() : "";
            const std::string scopedWeek = weekStart.empty() && selection["weekStart"].isString()
                ? selection["weekStart"].asString()
                : weekStart;
            if (!scopedWeek.empty()) {
                item["weekStart"] = scopedWeek;
            }
            normalized.append(item);
        }
        return normalized;
    }

    static bool isValidSlotIndex(int index) {
        return index >= 0 && index < 25;
    }

    static bool reservedContains(const Value &reserved, int slotIndex) {
        for (const auto &item : arrayOrEmpty(reserved)) {
            if (item.isInt() && item.asInt() == slotIndex) {
                return true;
            }
        }
        return false;
    }

    static Value sortUniqueIntArray(const Value &value) {
        std::vector<int> items;
        for (const auto &item : arrayOrEmpty(value)) {
            if (item.isInt() && isValidSlotIndex(item.asInt())) {
                items.push_back(item.asInt());
            }
        }
        std::sort(items.begin(), items.end());
        items.erase(std::unique(items.begin(), items.end()), items.end());
        Value result(Json::arrayValue);
        for (int item : items) {
            result.append(item);
        }
        return result;
    }

    static Value addReservedSlot(const Value &reserved, int slotIndex) {
        Value next = arrayOrEmpty(reserved);
        if (isValidSlotIndex(slotIndex) && !reservedContains(next, slotIndex)) {
            next.append(slotIndex);
        }
        return sortUniqueIntArray(next);
    }

    static Value removeReservedSlot(const Value &reserved, int slotIndex) {
        Value next(Json::arrayValue);
        for (const auto &item : arrayOrEmpty(reserved)) {
            if (item.isInt() && item.asInt() != slotIndex) {
                next.append(item.asInt());
            }
        }
        return sortUniqueIntArray(next);
    }

    static Value quickReserveOrder(const std::string &reserveType, int slotCount) {
        Value order(Json::arrayValue);
        const int priorityStart = reserveType == "T" ? 20 : (reserveType == "治疗" ? 15 : -1);
        if (priorityStart >= 0) {
            for (int index = priorityStart; index < priorityStart + 5 && index < slotCount; ++index) {
                order.append(index);
            }
        }
        for (int index = 0; index < slotCount; ++index) {
            if (!reservedContains(order, index)) {
                order.append(index);
            }
        }
        return order;
    }

    static std::string normalizeSpaceLimited(const std::string &value, int maxCodepoints) {
        std::string normalized;
        bool pendingSpace = false;
        for (unsigned char ch : value) {
            const bool control = ch <= 31 || ch == 127;
            if (std::isspace(ch) != 0 || control) {
                if (!normalized.empty()) {
                    pendingSpace = true;
                }
                continue;
            }
            if (pendingSpace) {
                normalized.push_back(' ');
                pendingSpace = false;
            }
            normalized.push_back(static_cast<char>(ch));
        }

        std::string limited;
        int codepoints = 0;
        for (std::size_t index = 0; index < normalized.size() && codepoints < maxCodepoints;) {
            const auto byte = static_cast<unsigned char>(normalized[index]);
            std::size_t width = 1;
            if ((byte & 0x80) == 0) {
                width = 1;
            } else if ((byte & 0xE0) == 0xC0) {
                width = 2;
            } else if ((byte & 0xF0) == 0xE0) {
                width = 3;
            } else if ((byte & 0xF8) == 0xF0) {
                width = 4;
            }
            if (index + width > normalized.size()) {
                break;
            }
            limited.append(normalized, index, width);
            index += width;
            codepoints += 1;
        }
        while (!limited.empty() && limited.back() == ' ') {
            limited.pop_back();
        }
        return limited;
    }

    static std::string normalizeTeamName(const std::string &value, const std::string &fallback) {
        const std::string normalized = normalizeSpaceLimited(value, 40);
        return normalized.empty() ? fallback : normalized;
    }

    static Value normalizeSlot(const Value &slot, int index, const Value &reservedSlots) {
        Value normalized = defaultSlot(index);
        if (!slot.isObject()) {
            if (reservedContains(reservedSlots, index)) {
                normalized["status"] = "reserved";
            }
            return normalized;
        }

        const std::string status = slot["status"].isString() ? slot["status"].asString() : "empty";
        const bool validRole = slot["fixedRole"].isString() &&
            (slot["fixedRole"].asString() == "T" || slot["fixedRole"].asString() == "治疗" || slot["fixedRole"].asString() == "DPS");
        const bool validMartialArt = slot["fixedMartialArtIndex"].isInt();

        if (status == "occupied" && slot["member"].isObject()) {
            normalized["status"] = "occupied";
            normalized["member"] = normalizeMember(slot["member"]);
            normalized["fixedRole"] = validRole ? Value(slot["fixedRole"].asString()) : Value(Json::nullValue);
            normalized["fixedMartialArtIndex"] = validMartialArt ? Value(slot["fixedMartialArtIndex"].asInt()) : Value(Json::nullValue);
            return normalized;
        }

        if (status == "fixed" && (validRole || validMartialArt)) {
            normalized["status"] = "fixed";
            normalized["fixedRole"] = validRole ? Value(slot["fixedRole"].asString()) : Value(Json::nullValue);
            normalized["fixedMartialArtIndex"] = validMartialArt ? Value(slot["fixedMartialArtIndex"].asInt()) : Value(Json::nullValue);
            return normalized;
        }

        if (status == "reserved" || reservedContains(reservedSlots, index)) {
            normalized["status"] = "reserved";
            return normalized;
        }

        return normalized;
    }

    static Value normalizeTeam(const Value &team, const std::string &fallbackName) {
        Value normalized;
        const std::string teamId = team["id"].isString() ? team["id"].asString() : "";
        normalized["id"] = teamId;
        normalized["name"] = normalizeTeamName(team["name"].isString() ? team["name"].asString() : "", fallbackName);
        normalized["note"] = team["note"].isString() ? team["note"].asString() : "";
        if (team["weekStart"].isString() && !team["weekStart"].asString().empty()) {
            normalized["weekStart"] = team["weekStart"].asString();
        }
        Value config = objectOrEmpty(team["config"]);
        Value sourceSlots = arrayOrEmpty(team["slots"]);
        Value reserved = sortUniqueIntArray(config["reservedSlots"]);
        for (Json::ArrayIndex index = 0; index < sourceSlots.size() && index < 25; ++index) {
            if (sourceSlots[index].isObject() && sourceSlots[index]["status"].asString() == "reserved") {
                reserved = addReservedSlot(reserved, static_cast<int>(index));
            }
        }
        normalized["config"]["locked"] = config["locked"].asBool();
        normalized["config"]["reservedSlots"] = reserved;
        normalized["slots"] = Value(Json::arrayValue);
        for (int index = 0; index < 25; ++index) {
            normalized["slots"].append(normalizeSlot(sourceSlots.isValidIndex(index) ? sourceSlots[index] : Value(Json::nullValue), index, reserved));
        }
        if (team["subsidyTypes"].isArray()) {
            normalized["subsidyTypes"] = normalizeSubsidyTypes(team["subsidyTypes"]);
        }
        if (team["memberSubsidies"].isObject()) {
            normalized["memberSubsidies"] = objectOrEmpty(team["memberSubsidies"]);
        }
        return normalized;
    }

    static std::string normalizeNickname(const std::string &value) {
        return normalizeSpaceLimited(value, 20);
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

    bool cleanExpiredLocksUnlocked(long long now = nowMs()) {
        bool changed = false;
        for (auto iterator = slotLocks_.begin(); iterator != slotLocks_.end();) {
            if (now - iterator->second.timestamp > lockTimeoutMs_) {
                iterator = slotLocks_.erase(iterator);
                changed = true;
            } else {
                ++iterator;
            }
        }
        if (changed) {
            bumpLockVersionUnlocked();
        }
        return changed;
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

    bool teamExistsUnlocked(const std::string &teamId) {
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT 1 FROM teams WHERE id = ?", &stmt);
        bindString(stmt, 1, teamId);
        const bool exists = sqlite3_step(stmt) == SQLITE_ROW;
        sqlite3_finalize(stmt);
        return exists;
    }

    int teamCountUnlocked() {
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT COUNT(*) FROM teams", &stmt);
        int count = 0;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            count = sqlite3_column_int(stmt, 0);
        }
        sqlite3_finalize(stmt);
        return count;
    }

    int nextTeamSortOrderUnlocked() {
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM teams", &stmt);
        int order = 0;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            order = sqlite3_column_int(stmt, 0);
        }
        sqlite3_finalize(stmt);
        return order;
    }

    std::string readTeamNameUnlocked(const std::string &teamId) {
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT name FROM teams WHERE id = ?", &stmt);
        bindString(stmt, 1, teamId);
        std::string name;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            name = textColumn(stmt, 0);
        }
        sqlite3_finalize(stmt);
        return name;
    }

    Value readTeamUnlocked(const std::string &teamId) {
        Value snapshot = bootstrapUnlocked();
        for (const auto &team : snapshot["teams"]) {
            if (team["id"].isString() && team["id"].asString() == teamId) {
                return team;
            }
        }
        return Value(Json::nullValue);
    }

    Value readArchivedTeamUnlocked(const std::string &archiveId) {
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT team_json FROM archives WHERE id = ?", &stmt);
        bindString(stmt, 1, archiveId);
        Value team(Json::nullValue);
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            team = normalizeTeam(parseJson(textColumn(stmt, 0), Value(Json::objectValue)), "默认团队");
        }
        sqlite3_finalize(stmt);
        return team;
    }

    void updateArchivedTeamUnlocked(const std::string &archiveId, const Value &team) {
        sqlite3_stmt *stmt = nullptr;
        prepare("UPDATE archives SET team_json = ? WHERE id = ?", &stmt);
        bindString(stmt, 1, writeJson(team));
        bindString(stmt, 2, archiveId);
        stepDone(stmt);
        sqlite3_finalize(stmt);
    }

    void updateTeamFromJsonUnlocked(const Value &team) {
        if (!team["id"].isString()) {
            throw std::runtime_error("Invalid team");
        }
        int sortOrder = 0;
        sqlite3_stmt *stmt = nullptr;
        prepare("SELECT sort_order FROM teams WHERE id = ?", &stmt);
        bindString(stmt, 1, team["id"].asString());
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            sortOrder = sqlite3_column_int(stmt, 0);
        } else {
            sortOrder = nextTeamSortOrderUnlocked();
        }
        sqlite3_finalize(stmt);
        insertTeamUnlocked(normalizeTeam(team, team["name"].isString() ? team["name"].asString() : "默认团队"), sortOrder);
    }

    void clearRuntimeLocksForTeamUnlocked(const std::string &teamId) {
        bool changed = teamLocks_.erase(teamId) > 0;
        for (auto iterator = slotLocks_.begin(); iterator != slotLocks_.end();) {
            if (iterator->second.teamId == teamId) {
                iterator = slotLocks_.erase(iterator);
                changed = true;
            } else {
                ++iterator;
            }
        }
        if (changed) {
            bumpLockVersionUnlocked();
        }
    }

    Value mutationVersionsUnlocked() {
        Value result = versionsUnlocked();
        result["ok"] = true;
        return result;
    }

    Value validateSlotMutationLockUnlocked(const std::string &teamId, int slotIndex, const std::string &qq, long long lockToken) {
        if (teamId.empty() || slotIndex < 0 || qq.empty() || lockToken <= 0) {
            return conflictJson("missingFields");
        }
        cleanExpiredLocksUnlocked();

        const auto teamLock = teamLocks_.find(teamId);
        if (teamLock != teamLocks_.end() && teamLock->second > lockToken) {
            Value conflict = conflictJson("teamLocked");
            conflict["lockedAt"] = static_cast<Json::Int64>(teamLock->second);
            return conflict;
        }

        const auto existing = slotLocks_.find(slotLockKey(teamId, slotIndex));
        if (existing == slotLocks_.end() || existing->second.qq != qq) {
            return conflictJson("expired");
        }

        if (existing->second.timestamp != lockToken || nowMs() - existing->second.timestamp > lockTimeoutMs_) {
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
        const auto existing = slotLocks_.find(slotLockKey(teamId, slotIndex));
        if (existing != slotLocks_.end() && existing->second.qq == qq) {
            slotLocks_.erase(existing);
        }
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
        lockVersion_ += 1;
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
        const Value normalizedSubsidyTypes = normalizeSubsidyTypes(team["subsidyTypes"]);
        const Value memberSubsidies = objectOrEmpty(team["memberSubsidies"]);

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
        bindOptionalString(stmt, 8, team["subsidyTypes"].isArray() ? std::optional<std::string>(writeJson(normalizedSubsidyTypes)) : std::nullopt);
        bindOptionalString(stmt, 9, team["memberSubsidies"].isObject() ? std::optional<std::string>(writeJson(memberSubsidies)) : std::nullopt);
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

    void cleanMemberSubsidiesForTypes(Value &team) {
        if (!team["memberSubsidies"].isObject()) {
            return;
        }
        std::unordered_set<std::string> validIds;
        for (const auto &type : arrayOrEmpty(team["subsidyTypes"])) {
            if (type["id"].isString()) {
                validIds.insert(type["id"].asString());
            }
        }
        Value cleaned(Json::objectValue);
        for (const auto &qq : team["memberSubsidies"].getMemberNames()) {
            Value validSelections(Json::arrayValue);
            for (const auto &selection : arrayOrEmpty(team["memberSubsidies"][qq])) {
                if (selection["typeId"].isString() && validIds.contains(selection["typeId"].asString())) {
                    validSelections.append(selection);
                }
            }
            if (!validSelections.empty()) {
                cleaned[qq] = normalizeMemberSubsidySelections(validSelections);
            }
        }
        team["memberSubsidies"] = cleaned;
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

    Value backupPayloadUnlocked() {
        Value payload;
        payload["version"] = 1;
        payload["createdAt"] = shanghaiTimestamp(nowMs());
        Value snapshot = bootstrapUnlocked();
        Value data;
        data["teams"] = snapshot["teams"];
        data["cancellations"] = snapshot["cancellations"];
        data["archivedTeams"] = snapshot["archivedTeams"];
        data["logs"] = snapshot["logs"];
        data["userProfiles"] = snapshot["userProfiles"];
        payload["data"] = data;
        Value locks;
        locks["slots"] = snapshot["locks"];
        locks["teams"] = snapshot["teamLocks"];
        payload["locks"] = locks;
        payload["subsidyPresets"] = snapshot["subsidyPresets"];
        return payload;
    }

    Value backupDataFromPayload(const Value &payload) {
        if (payload["data"].isObject()) {
            Value data = objectOrEmpty(payload["data"]);
            if (payload["subsidyPresets"].isArray()) {
                data["subsidyPresets"] = payload["subsidyPresets"];
            }
            return data;
        }
        if (payload["teams"].isArray()) {
            return payload;
        }
        return Value(Json::nullValue);
    }

    static std::string shanghaiTimestamp(long long timestamp) {
        const std::time_t seconds = static_cast<std::time_t>(timestamp / 1000 + 8 * 60 * 60);
        std::tm tm{};
        gmtime_s(&tm, &seconds);
        std::ostringstream output;
        output << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S");
        output << "." << std::setw(3) << std::setfill('0') << (timestamp % 1000) << "+08:00";
        return output.str();
    }

    static std::string backupFileTimestamp(long long timestamp) {
        const std::time_t seconds = static_cast<std::time_t>(timestamp / 1000 + 8 * 60 * 60);
        std::tm tm{};
        gmtime_s(&tm, &seconds);
        std::ostringstream output;
        output << std::put_time(&tm, "%Y%m%d-%H%M%S");
        output << "-" << std::setw(3) << std::setfill('0') << (timestamp % 1000);
        return output.str();
    }

    static std::optional<std::string> gzipInflate(const std::string &input) {
        if (input.size() < 2 || static_cast<unsigned char>(input[0]) != 0x1F || static_cast<unsigned char>(input[1]) != 0x8B) {
            return std::nullopt;
        }
        z_stream stream{};
        stream.next_in = reinterpret_cast<Bytef *>(const_cast<char *>(input.data()));
        stream.avail_in = static_cast<uInt>(input.size());
        if (inflateInit2(&stream, 16 + MAX_WBITS) != Z_OK) {
            return std::nullopt;
        }

        std::string output;
        char buffer[16 * 1024];
        int status = Z_OK;
        while (status == Z_OK) {
            stream.next_out = reinterpret_cast<Bytef *>(buffer);
            stream.avail_out = sizeof(buffer);
            status = inflate(&stream, Z_NO_FLUSH);
            output.append(buffer, sizeof(buffer) - stream.avail_out);
        }
        inflateEnd(&stream);
        if (status != Z_STREAM_END) {
            return std::nullopt;
        }
        return output;
    }

    static std::string gzipDeflate(const std::string &input) {
        z_stream stream{};
        if (deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 16 + MAX_WBITS, 8, Z_DEFAULT_STRATEGY) != Z_OK) {
            throw std::runtime_error("Cannot initialize gzip writer");
        }
        stream.next_in = reinterpret_cast<Bytef *>(const_cast<char *>(input.data()));
        stream.avail_in = static_cast<uInt>(input.size());

        std::string output;
        char buffer[16 * 1024];
        int status = Z_OK;
        while (status == Z_OK) {
            stream.next_out = reinterpret_cast<Bytef *>(buffer);
            stream.avail_out = sizeof(buffer);
            status = deflate(&stream, Z_FINISH);
            output.append(buffer, sizeof(buffer) - stream.avail_out);
        }
        deflateEnd(&stream);
        if (status != Z_STREAM_END) {
            throw std::runtime_error("Cannot write gzip data");
        }
        return output;
    }

    static void writeGzipFile(const std::filesystem::path &path, const std::string &content) {
        std::ofstream output(path, std::ios::binary);
        const std::string compressed = gzipDeflate(content);
        output.write(compressed.data(), static_cast<std::streamsize>(compressed.size()));
    }

    static std::string readFile(const std::filesystem::path &path) {
        std::ifstream input(path, std::ios::binary);
        std::ostringstream buffer;
        buffer << input.rdbuf();
        return buffer.str();
    }

    static std::string readMaybeGzipFile(const std::filesystem::path &path) {
        const std::string body = readFile(path);
        return gzipInflate(body).value_or(body);
    }

    std::filesystem::path resolveBackupPath(const std::string &name) const {
        const auto filename = std::filesystem::path(name).filename();
        if (filename.empty() || filename.string() != name) {
            throw std::runtime_error("Invalid backup name");
        }
        return backupDir_ / filename;
    }

    std::vector<BackupEntry> listBackupsUnlocked() {
        std::vector<BackupEntry> backups;
        std::filesystem::create_directories(backupDir_);
        for (const auto &entry : std::filesystem::directory_iterator(backupDir_)) {
            if (!entry.is_regular_file()) {
                continue;
            }
            const auto path = entry.path();
            const auto extension = path.extension().string();
            if (extension != ".gz" && extension != ".json") {
                continue;
            }
            BackupEntry backup;
            backup.name = path.filename().string();
            backup.size = entry.file_size();
            auto writeTime = entry.last_write_time();
            const auto systemTime = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                writeTime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now());
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(systemTime.time_since_epoch()).count();
            backup.createdAt = shanghaiTimestamp(ms);
            backups.push_back(backup);
        }
        std::sort(backups.begin(), backups.end(), [](const BackupEntry &left, const BackupEntry &right) {
            return left.name > right.name;
        });
        return backups;
    }

    static Value backupEntriesJson(const std::vector<BackupEntry> &backups) {
        Value items(Json::arrayValue);
        for (const auto &backup : backups) {
            Value item;
            item["name"] = backup.name;
            item["createdAt"] = backup.createdAt;
            item["size"] = static_cast<Json::UInt64>(backup.size);
            items.append(item);
        }
        return items;
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
        prepare("SELECT data_version FROM meta_versions WHERE id = 1", &stmt);
        Value json;
        json["ok"] = true;
        if (sqlite3_step(stmt) == SQLITE_ROW) {
            json["dataVersion"] = static_cast<Json::Int64>(sqlite3_column_int64(stmt, 0));
        } else {
            json["dataVersion"] = 1;
        }
        json["lockVersion"] = static_cast<Json::Int64>(lockVersion_);
        sqlite3_finalize(stmt);
        return json;
    }

    Value publicLocksUnlocked() {
        Value json;
        json["slots"] = Value(Json::arrayValue);
        json["teams"] = Value(Json::arrayValue);
        for (const auto &entry : slotLocks_) {
            const auto &lock = entry.second;
            Value item;
            item["teamId"] = lock.teamId;
            item["slotIndex"] = lock.slotIndex;
            item["qq"] = lock.qq;
            item["timestamp"] = static_cast<Json::Int64>(lock.timestamp);
            json["slots"].append(item);
        }

        for (const auto &[teamId, timestamp] : teamLocks_) {
            Value item;
            item["teamId"] = teamId;
            item["timestamp"] = static_cast<Json::Int64>(timestamp);
            json["teams"].append(item);
        }
        json["lockVersion"] = static_cast<Json::Int64>(lockVersion_);
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

bool isApiRequest(const HttpRequestPtr &request) {
    return request->path().rfind("/api/v2", 0) == 0;
}

void addCorsHeaders(const HttpRequestPtr &request, const HttpResponsePtr &response) {
    const auto &origin = request->getHeader("Origin");
    response->addHeader("Access-Control-Allow-Origin", origin.empty() ? "*" : origin);
    response->addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    response->addHeader("Access-Control-Max-Age", "86400");
    response->addHeader("Vary", "Origin");
}

void setupCors() {
    drogon::app().registerSyncAdvice([](const HttpRequestPtr &request) -> HttpResponsePtr {
        if (!isApiRequest(request) || request->method() != drogon::Options) {
            return nullptr;
        }
        auto response = drogon::HttpResponse::newHttpResponse();
        response->setStatusCode(drogon::k204NoContent);
        addCorsHeaders(request, response);
        return response;
    });

    drogon::app().registerPostHandlingAdvice([](const HttpRequestPtr &request, const HttpResponsePtr &response) {
        if (isApiRequest(request)) {
            addCorsHeaders(request, response);
        }
    });
}

} // namespace

int main() {
    const auto port = std::getenv("PORT") != nullptr ? std::atoi(std::getenv("PORT")) : 23219;
    const auto listenPort = static_cast<uint16_t>(std::clamp(port, 1, 65535));
    const std::filesystem::path dbPath = std::getenv("TEAMASSISTANT_DB") != nullptr
        ? std::getenv("TEAMASSISTANT_DB")
        : "backend-cpp/data/teamassistant.sqlite3";

    auto db = std::make_shared<SqliteDb>(dbPath);
    auto events = std::make_shared<VersionEventHub>();
    setupCors();

    auto publishVersion = [db, events]() {
        events->publish(db->versions());
    };
    auto respondMutation = [publishVersion](std::function<void(const HttpResponsePtr &)> &&callback, const Value &result) {
        callback(jsonResponse(result, statusForResult(result)));
        if (result["ok"].asBool()) {
            publishVersion();
        }
    };
    auto respondOkMutation = [publishVersion](std::function<void(const HttpResponsePtr &)> &&callback, const Value &result) {
        callback(jsonResponse(result));
        if (result["ok"].asBool()) {
            publishVersion();
        }
    };
    drogon::app().getLoop()->runEvery(5.0, [db, publishVersion]() {
        if (db->expireRuntimeLocks()) {
            publishVersion();
        }
    });
    drogon::app().getLoop()->runEvery(15.0, [events]() {
        events->heartbeat();
    });

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
        [db, respondOkMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing data"), drogon::k400BadRequest));
                return;
            }
            try {
                respondOkMutation(std::move(callback), db->replaceData(*json));
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
        [db, events](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            auto response = drogon::HttpResponse::newAsyncStreamResponse(
                [db, events](drogon::ResponseStreamPtr stream) {
                    events->subscribe(std::move(stream), db->versions());
                },
                true);
            response->setContentTypeCodeAndCustomString(drogon::CT_TEXT_PLAIN, "text/event-stream; charset=utf-8");
            response->addHeader("Cache-Control", "no-cache, no-transform");
            response->addHeader("Connection", "keep-alive");
            response->addHeader("X-Accel-Buffering", "no");
            callback(response);
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/locks",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            callback(jsonResponse(db->publicLocks()));
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/teams",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["team"].isObject()) {
                callback(jsonResponse(errorJson("Missing team"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->createTeam((*json)["team"]);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/teams/reorder",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing ids"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->reorderTeams((*json)["ids"]);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/teams/{1}",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing team patch"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->patchTeam(teamId, *json);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Patch});

    drogon::app().registerHandler("/api/v2/teams/{1}",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            const auto json = request->getJsonObject();
            try {
                const auto result = db->deleteTeam(teamId, json == nullptr ? Value(Json::nullValue) : (*json)["fallbackTeam"]);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/teams/{1}/archive",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing archive body"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->archiveTeam(
                    teamId,
                    (*json)["archivedBy"].isString() ? (*json)["archivedBy"].asString() : "",
                    toInt64((*json)["archivedAt"]),
                    (*json)["fallbackTeam"]);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/archives/{1}/restore",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &archiveId) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing restore body"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->restoreArchive(
                    archiveId,
                    (*json)["actorQq"].isString() ? (*json)["actorQq"].asString() : "",
                    toInt64((*json)["restoredAt"]));
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/teams/{1}/lock-state",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["locked"].isBool()) {
                callback(jsonResponse(errorJson("Missing locked"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->setTeamConfigLock(teamId, (*json)["locked"].asBool());
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Patch});

    drogon::app().registerHandler("/api/v2/slot-locks",
        [db, respondOkMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["teamId"].isString() || !(*json)["qq"].isString()) {
                callback(jsonResponse(errorJson("Missing fields"), drogon::k400BadRequest));
                return;
            }
            try {
                respondOkMutation(std::move(callback), db->acquireSlotLock(
                    (*json)["teamId"].asString(),
                    static_cast<int>(toInt64((*json)["slotIndex"])),
                    (*json)["qq"].asString()));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/slot-locks/{1}/{2}",
        [db, respondOkMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
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
                respondOkMutation(std::move(callback), ok);
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
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
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
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/teams/{1}/slots/{2}/member",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
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
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/teams/{1}/slots/{2}/cancel",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
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
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/teams/{1}/slots/{2}/role",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId, int slotIndex) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing role update"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->setSlotRole(
                    teamId,
                    slotIndex,
                    (*json)["role"],
                    (*json)["martialArtIndex"],
                    (*json)["assignQQ"].isString() ? (*json)["assignQQ"].asString() : "",
                    (*json)["actorQq"].isString() ? (*json)["actorQq"].asString() : "");
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/teams/{1}/quick-reserve",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["reserveType"].isString()) {
                callback(jsonResponse(errorJson("Missing quick reserve body"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->quickReserve(
                    teamId,
                    (*json)["reserveType"].asString(),
                    static_cast<int>(toInt64((*json)["count"])));
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/cancellations/{1}/{2}",
        [db, respondMutation](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &qq, long long timestamp) {
            try {
                const auto result = db->dismissCancellation(qq, timestamp);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/team-locks",
        [db, respondOkMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["teamId"].isString()) {
                callback(jsonResponse(errorJson("Missing teamId"), drogon::k400BadRequest));
                return;
            }
            try {
                respondOkMutation(std::move(callback), db->setTeamLock((*json)["teamId"].asString()));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/team-locks/{1}",
        [db, respondOkMutation](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            try {
                respondOkMutation(std::move(callback), db->removeTeamLock(teamId));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/user-profiles/{1}",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &qq) {
            const auto json = request->getJsonObject();
            if (json == nullptr || !(*json)["nickname"].isString()) {
                callback(jsonResponse(errorJson("Missing fields"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->updateUserProfile(qq, (*json)["nickname"].asString());
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

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
        [db, respondOkMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing presets"), drogon::k400BadRequest));
                return;
            }
            try {
                respondOkMutation(std::move(callback), db->updateSubsidyPresets((*json)["presets"]));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/teams/{1}/subsidy-types",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing subsidy types"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->updateTeamSubsidyTypes(teamId, (*json)["subsidyTypes"]);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/teams/{1}/subsidies/{2}",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &teamId, const std::string &qq) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing subsidy selections"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->registerMemberSubsidies(
                    std::optional<std::string>(teamId),
                    std::nullopt,
                    qq,
                    (*json)["selections"],
                    (*json)["weekStart"].isString() ? (*json)["weekStart"].asString() : "");
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/archives/{1}/subsidies/{2}",
        [db, respondMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &archiveId, const std::string &qq) {
            const auto json = request->getJsonObject();
            if (json == nullptr) {
                callback(jsonResponse(errorJson("Missing subsidy selections"), drogon::k400BadRequest));
                return;
            }
            try {
                const auto result = db->registerMemberSubsidies(
                    std::nullopt,
                    std::optional<std::string>(archiveId),
                    qq,
                    (*json)["selections"],
                    (*json)["weekStart"].isString() ? (*json)["weekStart"].asString() : "");
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Put});

    drogon::app().registerHandler("/api/v2/backups",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            try {
                callback(jsonResponse(db->backups()));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/backups",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback) {
            try {
                callback(jsonResponse(db->createBackup()));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/backups/{1}/restore",
        [db, respondMutation](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &name) {
            try {
                const auto result = db->restoreBackup(name);
                respondMutation(std::move(callback), result);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

    drogon::app().registerHandler("/api/v2/backups/{1}/download",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &name) {
            try {
                const auto path = db->backupDownloadPath(name);
                if (!path.has_value()) {
                    Value notFound;
                    notFound["ok"] = false;
                    notFound["reason"] = "notFound";
                    notFound["error"] = "Backup not found";
                    callback(jsonResponse(notFound, drogon::k404NotFound));
                    return;
                }
                const auto filename = path->filename().string();
                auto response = drogon::HttpResponse::newFileResponse(
                    path->string(),
                    filename,
                    drogon::CT_CUSTOM,
                    filename.ends_with(".gz") ? "application/gzip" : "application/json");
                response->addHeader("Cache-Control", "no-store");
                callback(response);
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Get});

    drogon::app().registerHandler("/api/v2/backups/{1}",
        [db](const HttpRequestPtr &, std::function<void(const HttpResponsePtr &)> &&callback,
             const std::string &name) {
            try {
                callback(jsonResponse(db->deleteBackup(name)));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Delete});

    drogon::app().registerHandler("/api/v2/backups/import",
        [db, respondOkMutation](const HttpRequestPtr &request, std::function<void(const HttpResponsePtr &)> &&callback) {
            try {
                const auto body = request->body();
                respondOkMutation(std::move(callback), db->importBackup(std::string(body.data(), body.size())));
            } catch (const std::exception &error) {
                callback(jsonResponse(errorJson(error.what()), drogon::k500InternalServerError));
            }
        },
        {drogon::Post});

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
        .addListener("0.0.0.0", listenPort)
        .setThreadNum((std::max)(2u, std::thread::hardware_concurrency()))
        .run();
}
