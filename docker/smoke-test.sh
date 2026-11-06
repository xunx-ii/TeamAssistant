#!/usr/bin/env bash
set -Eeuo pipefail

image=${1:?请指定待验证的镜像}
container="teamassistant-test-${RANDOM}-${RANDOM}"
volume="${container}-data"
password="test-${RANDOM}-${RANDOM}-${RANDOM}"

cleanup() {
    local status=$?
    trap - EXIT
    if (( status != 0 )); then docker logs "$container" 2>&1 || true; fi
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker volume rm "$volume" >/dev/null 2>&1 || true
    exit "$status"
}
trap cleanup EXIT

wait_healthy() {
    local health
    for ((attempt = 0; attempt < 90; attempt++)); do
        health=$(docker inspect --format '{{.State.Health.Status}}' "$container")
        if [[ "$health" == healthy ]]; then return; fi
        if [[ $(docker inspect --format '{{.State.Running}}' "$container") != true ]]; then break; fi
        sleep 1
    done
    echo '容器未能进入健康状态' >&2
    return 1
}

[[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == linux/amd64 ]]
docker volume create "$volume" >/dev/null
docker run --detach --name "$container" \
    --publish 127.0.0.1::8080 \
    --volume "${volume}:/data" \
    --env QQBOT_ENABLED=false \
    --env TEAMASSISTANT_ADMIN_QQS=10001 \
    --env "TEAMASSISTANT_ADMIN_PASSWORD=${password}" \
    "$image" >/dev/null
wait_healthy
address="http://$(docker port "$container" 8080/tcp)"

# 验证生产静态资源与同源 API，并检查机器人模块及其原生依赖可加载。
page=$(curl --fail --silent --show-error --max-time 10 "$address/")
asset=$(printf '%s' "$page" | sed -n 's/.*src="\.\/\(assets\/[^" ]*\.js\)".*/\1/p' | head -n 1)
[[ -n "$asset" ]]
curl --fail --silent --show-error --max-time 10 "$address/$asset" >/dev/null
curl --fail --silent --show-error --max-time 10 "$address/api/v2/version" | jq --exit-status '.ok == true' >/dev/null
docker exec --workdir /app/qqbot "$container" node --input-type=module --eval \
    "await import('./src/agent.js'); await import('./src/qq.js'); await import('@tencent-connect/qqbot-connector');"

login=$(jq -n --arg password "$password" '{actorQq: "10001", password: $password}')
token=$(curl --fail --silent --show-error --max-time 10 \
    --header 'Content-Type: application/json' --data "$login" \
    "$address/api/v2/admin/login" | jq --exit-status --raw-output '.adminToken | select(type == "string" and length > 0)')
team=$(jq -n --arg token "$token" '{
    actorQq: "10001", adminToken: $token,
    teams: [{id: "docker-test", name: "Docker持久化验证", note: "", config: {reservedSlots: [], locked: false},
        slots: [range(25) | {index: ., status: "empty", member: null, fixedRole: null, fixedMartialArtIndex: null}]}]
}')
curl --fail --silent --show-error --max-time 10 \
    --header 'Content-Type: application/json' --data "$team" \
    "$address/api/v2/teams/batch" | jq --exit-status '.ok == true' >/dev/null

# 重建容器，验证所有业务数据实际写入持久卷。
docker stop --time 30 "$container" >/dev/null
[[ $(docker inspect --format '{{.State.ExitCode}}' "$container") == 0 ]]
docker rm "$container" >/dev/null
docker run --detach --name "$container" \
    --publish 127.0.0.1::8080 \
    --volume "${volume}:/data" \
    --env QQBOT_ENABLED=false \
    --env "TEAMASSISTANT_ADMIN_PASSWORD=${password}" \
    "$image" >/dev/null
wait_healthy
address="http://$(docker port "$container" 8080/tcp)"
curl --fail --silent --show-error --max-time 10 "$address/api/v2/bootstrap" \
    | jq --exit-status 'any(.teams[]; .id == "docker-test")' >/dev/null

# 后端意外退出时，入口进程必须停止容器，避免继续返回静态页面掩盖故障。
docker exec "$container" node --input-type=module --eval '
    import { readdirSync, readFileSync } from "node:fs";
    const pid = readdirSync("/proc").find(entry => {
        if (!/^\d+$/.test(entry)) return false;
        try { return readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0")[0] === "/app/backend-cpp/teamassistant_backend"; }
        catch { return false; }
    });
    if (!pid) throw new Error("Backend process was not found");
    process.kill(Number(pid), "SIGKILL");
'
exit_code=$(timeout 30s docker wait "$container")
[[ "$exit_code" != 0 ]]
echo 'AMD64 镜像验证通过：静态资源、API、机器人依赖、持久化及进程退出行为正常。'
