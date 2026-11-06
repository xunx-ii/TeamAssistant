#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

mkdir -p /data/backend /data/qqbot /data/home
ln -sfn /app/backend-cpp/schema.sql /data/backend/schema.sql

# 允许用同一镜像执行扫码绑定、数据库维护等一次性命令。
if (( $# > 0 )); then
    exec "$@"
fi

case "${QQBOT_ENABLED:-true}" in
    true|false) ;;
    *) echo '[boot] QQBOT_ENABLED 必须为 true 或 false' >&2; exit 1 ;;
esac
if [[ "${PORT:-23219}" != 23219 ]]; then
    echo '[boot] 容器内 PORT 固定为 23219，外部访问端口请通过 Docker 端口映射修改' >&2
    exit 1
fi

pids=()
# shellcheck disable=SC2329
shutdown() {
    local status=$?
    trap - EXIT TERM INT
    if (( ${#pids[@]} > 0 )); then
        kill -TERM "${pids[@]}" 2>/dev/null || true
        # 给数据库和机器人会话留出关闭时间，防止子进程卡住容器退出。
        (sleep 20; kill -KILL "${pids[@]}" 2>/dev/null || true) &
        local watchdog=$!
        wait "${pids[@]}" 2>/dev/null || true
        kill "$watchdog" 2>/dev/null || true
        wait "$watchdog" 2>/dev/null || true
    fi
    exit "$status"
}
trap 'shutdown' EXIT
trap 'exit 0' TERM INT

node /app/docker/prepare-config.mjs
nginx -t -c /app/docker/nginx.conf

(
    cd /data/backend
    exec /app/backend-cpp/teamassistant_backend
) &
backend_pid=$!
pids+=("$backend_pid")

ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
    if ! kill -0 "$backend_pid" 2>/dev/null; then
        echo '[boot] C++ 后端启动失败' >&2
        exit 1
    fi
    if curl --fail --silent --max-time 1 "http://127.0.0.1:${PORT:-23219}/api/v2/version" >/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    echo '[boot] C++ 后端启动超时' >&2
    exit 1
fi

if [[ "${QQBOT_ENABLED:-true}" == true ]]; then
    (
        cd /data/qqbot
        exec node /app/qqbot/src/index.js
    ) &
    pids+=("$!")
fi

nginx -c /app/docker/nginx.conf -g 'daemon off;' &
pids+=("$!")

# 任一服务退出均关闭容器，由 Docker 的重启策略恢复整组服务。
status=0
exited_pid=''
wait -n -p exited_pid "${pids[@]}" || status=$?
remaining=()
for pid in "${pids[@]}"; do
    if [[ "$pid" != "$exited_pid" ]]; then remaining+=("$pid"); fi
done
pids=("${remaining[@]}")
echo "[boot] 服务进程 ${exited_pid} 已退出（${status}），正在停止容器" >&2
if (( status == 0 )); then status=1; fi
exit "$status"
