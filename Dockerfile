# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build-base
# Use the distribution's current security updates for system packages.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        libssl-dev \
        ninja-build \
        pkg-config \
        python3 \
        uuid-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM build-base AS frontend-build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm test && npm run lint && npm run build

FROM build-base AS qqbot-build
WORKDIR /app/qqbot
COPY qqbot/package.json qqbot/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY qqbot/src ./src
COPY qqbot/test ./test
RUN npm run test:client
COPY docker/prepare-config.mjs /app/docker/prepare-config.mjs
COPY docker/test /app/docker/test
RUN node --test /app/docker/test/*.test.mjs

FROM build-base AS backend-build
COPY backend-cpp ./backend-cpp
RUN cmake -S backend-cpp -B backend-cpp/build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_C-ARES=OFF \
    && cmake --build backend-cpp/build --target teamassistant_backend --parallel 2
# Backend integration tests use the bot API client and its configuration dependencies.
COPY --from=qqbot-build /app/qqbot ./qqbot
COPY docs/migration.md ./docs/migration.md
RUN node --test backend-cpp/tests/*.test.mjs \
    && strip backend-cpp/build/teamassistant_backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    HOME=/data/home \
    PORT=23219 \
    QQBOT_ENABLED=true \
    TEAMASSISTANT_DB=/data/backend/teamassistant.sqlite3 \
    TEAMASSISTANT_ADMIN_CONFIG=/data/backend/admin.json \
    TEAMASSISTANT_BASE_URL=http://127.0.0.1:23219/api/v2
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fd-find \
        git \
        libssl3 \
        libuuid1 \
        nginx \
        ripgrep \
        tini \
        tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && mkdir -p /app/qqbot /data/backend /data/qqbot /data/home \
    && ln -s /data/qqbot /app/qqbot/data \
    && ln -s /data/qqbot/credentials.json /app/qqbot/credentials.json \
    && chown -R node:node /data
WORKDIR /app
COPY --from=frontend-build /app/frontend/dist ./frontend
COPY --from=qqbot-build /app/qqbot/node_modules ./qqbot/node_modules
COPY --from=qqbot-build /app/qqbot/package.json ./qqbot/package.json
COPY --from=qqbot-build /app/qqbot/src ./qqbot/src
COPY --from=backend-build /app/backend-cpp/build/teamassistant_backend ./backend-cpp/teamassistant_backend
COPY backend-cpp/schema.sql ./backend-cpp/schema.sql
COPY docker/nginx.conf docker/prepare-config.mjs ./docker/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/teamassistant-entrypoint
USER 1000:1000
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["curl", "--fail", "--silent", "--max-time", "4", "--output", "/dev/null", "http://127.0.0.1:8080/api/v2/version"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/teamassistant-entrypoint"]
CMD []
