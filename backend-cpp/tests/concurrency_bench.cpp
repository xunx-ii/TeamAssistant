#include <drogon/drogon.h>
#include <json/json.h>
#include <trantor/net/EventLoopThread.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <numeric>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;
using Json::Value;

struct Config {
    std::string baseUrl = "http://127.0.0.1:23219";
    int clients = 30;
    int timeoutSeconds = 10;
    bool prepareData = true;
    bool sameSlot = false;
};

struct HttpResult {
    bool ok = false;
    int status = 0;
    drogon::ReqResult requestResult = drogon::ReqResult::NetworkFailure;
    Value json = Value(Json::objectValue);
    std::string body;
};

struct WorkerResult {
    int index = 0;
    bool lockOk = false;
    bool saveOk = false;
    long long lockMs = 0;
    long long saveMs = 0;
    long long totalMs = 0;
    std::string reason;
    int lockStatus = 0;
    int saveStatus = 0;
};

std::string writeJson(const Value &value) {
    Json::StreamWriterBuilder builder;
    builder["indentation"] = "";
    return Json::writeString(builder, value);
}

Value parseJson(const std::string &body) {
    Json::CharReaderBuilder builder;
    std::string errors;
    std::istringstream input(body);
    Value parsed;
    if (!Json::parseFromStream(builder, input, &parsed, &errors)) {
        return Value(Json::objectValue);
    }
    return parsed;
}

std::string trimTrailingSlash(std::string value) {
    while (!value.empty() && value.back() == '/') {
        value.pop_back();
    }
    return value;
}

std::string apiPath(const std::string &path) {
    return "/api/v2" + path;
}

void usage() {
    std::cout
        << "Usage: teamassistant_concurrency_bench [--url http://127.0.0.1:23219] [--clients 30] [--no-prepare] [--same-slot]\n"
        << "\n"
        << "Runs concurrent signup flows by default: acquire slot lock, then save member.\n"
        << "--same-slot makes all clients compete for one team/slot and expects one winner.\n";
}

Config parseArgs(int argc, char **argv) {
    Config config;
    if (const char *url = std::getenv("BENCH_URL")) {
        config.baseUrl = url;
    }
    if (const char *clients = std::getenv("BENCH_CLIENTS")) {
        config.clients = std::max(1, std::atoi(clients));
    }

    for (int index = 1; index < argc; ++index) {
        const std::string arg = argv[index];
        if (arg == "--help" || arg == "-h") {
            usage();
            std::exit(0);
        }
        if (arg == "--url" && index + 1 < argc) {
            config.baseUrl = argv[++index];
            continue;
        }
        if (arg == "--clients" && index + 1 < argc) {
            config.clients = std::max(1, std::atoi(argv[++index]));
            continue;
        }
        if (arg == "--timeout" && index + 1 < argc) {
            config.timeoutSeconds = std::max(1, std::atoi(argv[++index]));
            continue;
        }
        if (arg == "--no-prepare") {
            config.prepareData = false;
            continue;
        }
        if (arg == "--same-slot") {
            config.sameSlot = true;
            continue;
        }
        throw std::runtime_error("Unknown argument: " + arg);
    }

    config.baseUrl = trimTrailingSlash(config.baseUrl);
    return config;
}

HttpResult requestJson(
    const drogon::HttpClientPtr &client,
    drogon::HttpMethod method,
    const std::string &path,
    const Value &body = Value(Json::nullValue),
    int timeoutSeconds = 10
) {
    auto request = drogon::HttpRequest::newHttpRequest();
    request->setMethod(method);
    request->setPath(apiPath(path));
    if (!body.isNull()) {
        request->setContentTypeCode(drogon::CT_APPLICATION_JSON);
        request->setBody(writeJson(body));
    }

    auto [result, response] = client->sendRequest(request, timeoutSeconds);
    HttpResult output;
    output.requestResult = result;
    if (response) {
        output.status = static_cast<int>(response->getStatusCode());
        output.body = std::string(response->getBody());
        output.json = parseJson(output.body);
    }
    output.ok = result == drogon::ReqResult::Ok &&
        response &&
        output.status >= 200 &&
        output.status < 300 &&
        output.json["ok"].asBool();
    return output;
}

Value emptySlot(int index) {
    Value slot;
    slot["index"] = index;
    slot["status"] = "empty";
    slot["member"] = Value(Json::nullValue);
    slot["fixedRole"] = Value(Json::nullValue);
    slot["fixedMartialArtIndex"] = Value(Json::nullValue);
    return slot;
}

Value benchTeam(int index) {
    Value team;
    team["id"] = "bench-team-" + std::to_string(index);
    team["name"] = "Bench Team " + std::to_string(index + 1);
    team["note"] = "";
    team["config"]["reservedSlots"] = Value(Json::arrayValue);
    team["config"]["locked"] = false;
    team["slots"] = Value(Json::arrayValue);
    for (int slot = 0; slot < 25; ++slot) {
        team["slots"].append(emptySlot(slot));
    }
    return team;
}

Value preparePayload(int clients, bool sameSlot) {
    Value data;
    data["teams"] = Value(Json::arrayValue);
    const int teamCount = sameSlot ? 1 : clients;
    for (int index = 0; index < teamCount; ++index) {
        data["teams"].append(benchTeam(index));
    }
    data["cancellations"] = Value(Json::arrayValue);
    data["archivedTeams"] = Value(Json::arrayValue);
    data["logs"] = Value(Json::arrayValue);
    data["userProfiles"] = Value(Json::objectValue);
    data["subsidyPresets"] = Value(Json::arrayValue);
    return data;
}

Value memberPayload(int index) {
    Value member;
    member["qq"] = "bench-qq-" + std::to_string(10000 + index);
    member["martialArtIndex"] = std::to_string(index % 10);
    member["gearScore"] = std::to_string(12000 + index);
    member["characterId"] = "BenchRole" + std::to_string(index + 1);
    member["note"] = "";
    member["hasOrangeWeapon"] = false;
    return member;
}

std::string resultReason(const HttpResult &response) {
    if (response.json["reason"].isString()) {
        return response.json["reason"].asString();
    }
    if (response.json["error"].isString()) {
        return response.json["error"].asString();
    }
    return "";
}

class StartGate {
public:
    explicit StartGate(int expected) : expected_(expected) {}

    void wait() {
        std::unique_lock lock(mutex_);
        arrived_ += 1;
        if (arrived_ >= expected_) {
            ready_ = true;
            condition_.notify_all();
            return;
        }
        condition_.wait(lock, [this] { return ready_; });
    }

private:
    int expected_ = 0;
    int arrived_ = 0;
    bool ready_ = false;
    std::mutex mutex_;
    std::condition_variable condition_;
};

WorkerResult signupFlow(const Config &config, trantor::EventLoop *loop, StartGate &gate, int index) {
    auto client = drogon::HttpClient::newHttpClient(config.baseUrl, loop);
    WorkerResult result;
    result.index = index;
    const std::string teamId = config.sameSlot ? "bench-team-0" : "bench-team-" + std::to_string(index);
    const int slotIndex = config.sameSlot ? 0 : index % 25;
    const std::string qq = "bench-qq-" + std::to_string(10000 + index);

    gate.wait();
    const auto started = Clock::now();

    Value lockBody;
    lockBody["teamId"] = teamId;
    lockBody["slotIndex"] = slotIndex;
    lockBody["qq"] = qq;

    const auto lockStarted = Clock::now();
    const HttpResult lockResponse = requestJson(client, drogon::Post, "/slot-locks", lockBody, config.timeoutSeconds);
    const auto lockFinished = Clock::now();
    result.lockMs = std::chrono::duration_cast<std::chrono::milliseconds>(lockFinished - lockStarted).count();
    result.lockStatus = lockResponse.status;
    result.lockOk = lockResponse.ok;
    if (!result.lockOk) {
        result.reason = resultReason(lockResponse);
        if (result.reason.empty()) {
            result.reason = "lock failed: " + std::string(drogon::to_string_view(lockResponse.requestResult)) +
                " http=" + std::to_string(lockResponse.status) + " body=" + lockResponse.body;
        }
        result.totalMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count();
        return result;
    }

    if (config.sameSlot) {
        result.totalMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count();
        return result;
    }

    Value saveBody;
    saveBody["qq"] = qq;
    saveBody["actorQq"] = qq;
    saveBody["member"] = memberPayload(index);
    saveBody["lockToken"] = lockResponse.json["lockToken"];
    saveBody["expectedMemberQq"] = Value(Json::nullValue);

    const auto saveStarted = Clock::now();
    const HttpResult saveResponse = requestJson(
        client,
        drogon::Put,
        "/teams/" + teamId + "/slots/" + std::to_string(slotIndex) + "/member",
        saveBody,
        config.timeoutSeconds);
    const auto saveFinished = Clock::now();
    result.saveMs = std::chrono::duration_cast<std::chrono::milliseconds>(saveFinished - saveStarted).count();
    result.saveStatus = saveResponse.status;
    result.saveOk = saveResponse.ok;
    if (!result.saveOk) {
        result.reason = resultReason(saveResponse);
        if (result.reason.empty()) {
            result.reason = "save failed: " + std::string(drogon::to_string_view(saveResponse.requestResult)) +
                " http=" + std::to_string(saveResponse.status) + " body=" + saveResponse.body;
        }
    }

    result.totalMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count();
    return result;
}

long long percentile(std::vector<long long> values, double p) {
    if (values.empty()) {
        return 0;
    }
    std::sort(values.begin(), values.end());
    const double rawIndex = (static_cast<double>(values.size() - 1) * p);
    const auto index = static_cast<std::size_t>(std::ceil(rawIndex));
    return values[std::min(index, values.size() - 1)];
}

void printStats(const std::string &label, const std::vector<long long> &values) {
    if (values.empty()) {
        std::cout << label << ": no successful samples\n";
        return;
    }
    const auto minmax = std::minmax_element(values.begin(), values.end());
    const long long sum = std::accumulate(values.begin(), values.end(), 0LL);
    std::cout
        << label
        << " count=" << values.size()
        << " min=" << *minmax.first << "ms"
        << " avg=" << std::fixed << std::setprecision(1) << (static_cast<double>(sum) / values.size()) << "ms"
        << " p50=" << percentile(values, 0.50) << "ms"
        << " p95=" << percentile(values, 0.95) << "ms"
        << " max=" << *minmax.second << "ms\n";
}

} // namespace

int main(int argc, char **argv) {
    try {
        const Config config = parseArgs(argc, argv);
        if (config.clients < 1) {
            throw std::runtime_error("clients must be greater than zero");
        }

        trantor::Logger::setLogLevel(trantor::Logger::kWarn);
        trantor::EventLoopThread loopThread("bench-http");
        loopThread.run();
        auto client = drogon::HttpClient::newHttpClient(config.baseUrl, loopThread.getLoop());

        const HttpResult version = requestJson(client, drogon::Get, "/version", Value(Json::nullValue), config.timeoutSeconds);
        if (!version.ok) {
            std::cerr << "Backend is not ready at " << config.baseUrl << "\n"
                      << "version request failed: " << std::string(drogon::to_string_view(version.requestResult))
                      << " http=" << version.status << " body=" << version.body << "\n";
            return 2;
        }

        if (config.prepareData) {
            Value payload = preparePayload(config.clients, config.sameSlot);
            payload["actorQq"] = "89906502";
            const HttpResult prepared = requestJson(client, drogon::Put, "/data", payload, config.timeoutSeconds);
            if (!prepared.ok) {
                std::cerr << "Failed to prepare benchmark data: "
                          << std::string(drogon::to_string_view(prepared.requestResult))
                          << " http=" << prepared.status << " body=" << prepared.body << "\n";
                return 3;
            }
        }

        std::vector<WorkerResult> results(static_cast<std::size_t>(config.clients));
        std::vector<std::thread> threads;
        threads.reserve(static_cast<std::size_t>(config.clients));
        StartGate gate(config.clients);

        const auto batchStarted = Clock::now();
        for (int index = 0; index < config.clients; ++index) {
            threads.emplace_back([&config, &gate, &results, index, loop = loopThread.getLoop()]() {
                results[static_cast<std::size_t>(index)] = signupFlow(config, loop, gate, index);
            });
        }

        for (auto &thread : threads) {
            thread.join();
        }
        const auto batchMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - batchStarted).count();

        int lockSuccess = 0;
        int saveSuccess = 0;
        std::vector<long long> lockLatencies;
        std::vector<long long> saveLatencies;
        std::vector<long long> totalLatencies;
        for (const auto &result : results) {
            if (result.lockOk) {
                lockSuccess += 1;
                lockLatencies.push_back(result.lockMs);
            }
            if (result.saveOk) {
                saveSuccess += 1;
                saveLatencies.push_back(result.saveMs);
                totalLatencies.push_back(result.totalMs);
            }
        }

        std::cout << "TeamAssistant signup concurrency benchmark\n";
        std::cout << "url=" << config.baseUrl << " clients=" << config.clients
                  << " prepareData=" << (config.prepareData ? "true" : "false")
                  << " sameSlot=" << (config.sameSlot ? "true" : "false")
                  << " batchElapsed=" << batchMs << "ms\n";
        std::cout << "lockSuccess=" << lockSuccess << "/" << config.clients
                  << " saveSuccess=" << saveSuccess << "/" << config.clients << "\n";
        printStats("lock", lockLatencies);
        printStats("save", saveLatencies);
        printStats("total", totalLatencies);

        if (!config.sameSlot && saveSuccess != config.clients) {
            std::cout << "\nFailures:\n";
            for (const auto &result : results) {
                if (!result.saveOk) {
                    std::cout << "#" << result.index
                              << " lockOk=" << (result.lockOk ? "true" : "false")
                              << " saveOk=" << (result.saveOk ? "true" : "false")
                              << " lockHttp=" << result.lockStatus
                              << " saveHttp=" << result.saveStatus
                              << " reason=" << result.reason << "\n";
                }
            }
            return 1;
        }

        if (config.sameSlot && lockSuccess != 1) {
            std::cout << "\nExpected exactly one same-slot lock winner.\n";
            std::cout << "Results:\n";
            for (const auto &result : results) {
                std::cout << "#" << result.index
                          << " lockOk=" << (result.lockOk ? "true" : "false")
                          << " saveOk=" << (result.saveOk ? "true" : "false")
                          << " lockHttp=" << result.lockStatus
                          << " saveHttp=" << result.saveStatus
                          << " total=" << result.totalMs << "ms"
                          << " reason=" << result.reason << "\n";
            }
            return 1;
        }

        return 0;
    } catch (const std::exception &error) {
        std::cerr << "Benchmark failed: " << error.what() << "\n";
        return 1;
    }
}
