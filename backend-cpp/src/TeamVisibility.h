#pragma once

#include <json/json.h>
#include <string>
#include <unordered_set>

namespace teamassistant {

constexpr long long kMaxPublicationTimeMs = 8'640'000'000'000'000;

inline bool validPublication(const Json::Value &config) {
    if (!config.isNull() && !config.isObject()) return false;
    return (!config.isMember("publicSignup") || config["publicSignup"].isBool()) &&
        (!config.isMember("publicAtMs") || (config["publicAtMs"].isInt64() &&
            config["publicAtMs"].asInt64() >= 0 && config["publicAtMs"].asInt64() <= kMaxPublicationTimeMs));
}

inline bool isTeamPublic(const Json::Value &team, long long nowMs) {
    const auto &config = team["config"];
    if (!validPublication(config)) return false;
    return (!config["publicSignup"].isBool() || config["publicSignup"].asBool()) &&
        (!config["publicAtMs"].isInt64() || config["publicAtMs"].asInt64() <= nowMs);
}

struct ViewerVisibility {
    bool unrestricted = false;
    std::string key = "public";
    long long dataVersion = 0;
    long long nextPublicAtMs = 0;
    std::unordered_set<std::string> teamIds;
    std::unordered_set<std::string> historyTeamIds;
    std::unordered_set<std::string> archiveIds;

    bool allowsTeam(const std::string &id) const {
        return unrestricted || teamIds.contains(id);
    }

    bool allowsHistory(const Json::Value &item) const {
        return item["teamId"].isString() && (unrestricted || item["teamId"].asString().empty() || historyTeamIds.contains(item["teamId"].asString()));
    }

    template<class Predicate>
    static Json::Value filter(const Json::Value &items, Predicate predicate) {
        Json::Value result(Json::arrayValue);
        for (const auto &item : items) if (predicate(item)) result.append(item);
        return result;
    }

    Json::Value locks(Json::Value state) const {
        if (unrestricted) return state;
        for (const auto *key : {"slots", "teams"}) {
            state[key] = filter(state[key], [this](const auto &item) {
                return item["teamId"].isString() && allowsTeam(item["teamId"].asString());
            });
        }
        return state;
    }

    Json::Value snapshot(Json::Value data) const {
        if (unrestricted) return data;
        data["teams"] = filter(data["teams"], [this](const auto &team) { return allowsTeam(team["id"].asString()); });
        data["archivedTeams"] = filter(data["archivedTeams"], [this](const auto &archive) { return archiveIds.contains(archive["id"].asString()); });
        data["logs"] = filter(data["logs"], [this](const auto &item) { return allowsHistory(item); });
        data["cancellations"] = filter(data["cancellations"], [this](const auto &item) { return allowsHistory(item); });
        for (const auto *key : {"locks", "teamLocks"}) {
            data[key] = filter(data[key], [this](const auto &item) {
                return item["teamId"].isString() && allowsTeam(item["teamId"].asString());
            });
        }
        return data;
    }

    Json::Value patches(const Json::Value &items) const {
        if (unrestricted || !items.isArray()) return items;
        return filter(items, [this](const auto &patch) {
            return !patch["teamId"].isString() || allowsTeam(patch["teamId"].asString());
        });
    }
};

} // namespace teamassistant
