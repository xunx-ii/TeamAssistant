# TeamAssistant

TeamAssistant 已拆分为独立 React/Vite 前端和 Drogon/SQLite C++ 后端。

## 目录

- `frontend/`: 前端应用、Vite 配置和前端测试。
- `backend-cpp/`: C++ 后端、CMake 配置和本地依赖源码。
- `docs/`: API v2 与迁移说明。
- `scripts/`: 根目录调度脚本。

## Docker 快速部署

镜像包含 QQ BOT、构建后的 frontend、backend-cpp 和 Nginx，仅支持 `linux/amd64`（AMD / Intel x86-64）。对外统一提供 `8080` 端口，前端通过同源 `/api/v2` 访问后端；不需要另外部署 Node、Vite 或 C++ 环境。

### GitHub Actions 自动发布

`.github/workflows/docker.yml` 在以下情况下运行：

- 推送到 `master` / `main`：构建、验证并发布镜像；仓库默认分支额外更新 `latest`。
- 推送 `v*` 标签：发布同名版本镜像，例如 `v1.0.0`。
- 向 `master` / `main` 提交 Pull Request：只构建和验证。
- 在 Actions 页面选择 **Build and publish Docker image → Run workflow**：手动构建并发布当前选择的分支。

镜像发布到 `ghcr.io/<仓库所有者>/<仓库名>`，地址自动转成小写。当前仓库默认地址为 `ghcr.io/xunx-ii/teamassistant:latest`，每次发布同时提供 `sha-<完整提交哈希>` 标签。工作流使用仓库自带的 `GITHUB_TOKEN`，无需额外配置 Docker Hub 账号或密钥；仓库 Actions 设置需允许工作流写入 Packages。

发布前会执行前端测试、lint、生产构建、QQ BOT 客户端测试及真实 C++ 后端集成测试，然后启动容器检查静态资源、API、机器人依赖、重建容器后的数据持久化和服务退出行为。构建使用 GitHub Actions 缓存，不进行 ARM 构建或 QEMU 模拟。发布结果和镜像摘要显示在 Actions 的运行摘要中。

### 启动服务

将仓库中的 `compose.yml` 和 `.env.example` 保存到服务器的同一目录，执行：

```bash
cp .env.example .env
```

编辑 `.env`，填写 `TEAMASSISTANT_ADMIN_QQS`（管理员 QQ，多人用英文逗号分隔）、`TEAMASSISTANT_ADMIN_PASSWORD`、`QQ_APP_ID` / `QQ_APP_SECRET`，以及机器人使用的模型配置。模型相关配置参考 `qqbot/.env.example`，可以直接将 `CUSTOM_*` 或所用 provider 的 API Key 加入根目录 `.env`。

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

访问 `http://服务器IP:8080`。通过 `.env` 中的 `TEAMASSISTANT_HTTP_PORT` 修改宿主机端口，通过 `TEAMASSISTANT_IMAGE` 指定版本标签或 `ghcr.io/xunx-ii/teamassistant@sha256:摘要`。

首次发布后，如需让服务器匿名拉取镜像，在 GitHub 仓库的 **Packages → teamassistant → Package settings → Change visibility** 中设为 Public。保留私有镜像时，先在服务器使用具有 `read:packages` 权限的令牌登录：

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u 你的GitHub用户名 --password-stdin
```

如果使用扫码绑定，可先保留 `.env` 中的 QQ 凭据为空，运行：

```bash
docker compose run --rm --no-deps teamassistant node /app/qqbot/src/bind.js
docker compose up -d
```

绑定凭据会保存在同一个持久卷中。仅运行网站时设置 `QQBOT_ENABLED=false`；机器人仍保留在镜像中。正常启用机器人时，缺少 QQ 凭据会让容器启动失败。CI 不连接真实 QQ 网关或模型服务，正式部署仍需有效的机器人和模型凭据。

### 数据与更新

服务使用非 root 用户（UID / GID `1000:1000`）运行。命名卷 `teamassistant-data` 挂载到 `/data`，包含：

- `/data/backend/`：业务 SQLite 数据库、备份及管理员配置。
- `/data/qqbot/`：机器人 SQLite 记录、扫码凭据及自动生成的模型配置。
- `/data/home/`：机器人使用的用户目录，包括 pi 登录配置。

环境变量中的管理员名单在每次启动时同步到 `/data/backend/admin.json`；密码和模型密钥通过进程环境传入。也可以将自己的 `admin.json` 只读挂载到该路径，此时从 `.env` 删除 `TEAMASSISTANT_ADMIN_QQS`，密码仍可使用 `TEAMASSISTANT_ADMIN_PASSWORD` 或 `TEAMASSISTANT_ADMIN_PASSWORD_SALT` / `TEAMASSISTANT_ADMIN_PASSWORD_HASH`。镜像构建会排除本地数据库、`.env`、管理员配置和机器人凭据。

```bash
docker compose pull
docker compose up -d
```

更新会保留数据卷。`docker compose down` 也会保留数据，`docker compose down -v` 会删除全部持久数据，备份时请保存数据卷。该部署使用本地 SQLite，应运行单个容器实例；如改用宿主机目录挂载，请先确保目录归 `1000:1000` 所有。

### 本地构建镜像

```bash
docker build --platform linux/amd64 -t teamassistant:local .
TEAMASSISTANT_IMAGE=teamassistant:local docker compose up -d
```

## 本地运行

```bash
npm install
npm run backend:configure
npm run backend:build
npm run dev
```

`npm run dev` 会启动 `backend-cpp` 构建产物，并启动 Vite。前端会把 `/api/v2` 代理到 `http://127.0.0.1:23219`。
默认前端监听 `0.0.0.0:5173`，同机访问 `http://127.0.0.1:5173`，局域网访问 `http://服务器IP:5173`。如果 5173 已被占用，先停掉旧服务，或用 `VITE_PORT=其他端口 npm run dev` 指定端口；如果只想本机访问，可用 `VITE_HOST=127.0.0.1 npm run dev`。
通过域名访问 Vite 开发服务器时，默认已允许 `team.hk.xunx.cc`；其它域名可用 `VITE_ALLOWED_HOSTS=域名1,域名2 npm run dev` 增加。

## 管理员密码

管理员 QQ 仍配置在 `backend-cpp/admin.json`。后端未配置管理员密码时会拒绝管理员登录；本地或部署时建议用环境变量：

```bash
TEAMASSISTANT_ADMIN_PASSWORD=你的强密码 npm run dev
```

也可以设置 `TEAMASSISTANT_ADMIN_PASSWORD_SALT` 与 `TEAMASSISTANT_ADMIN_PASSWORD_HASH`，或更新 `admin.json` 中的 `adminPasswordSalt` / `adminPasswordHash`。

生成哈希示例：

```bash
node scripts/admin-password-hash.mjs 你的强密码
```

## 提前报名与公开报名

创建团队时默认公开。勾选“不公开报名”后才显示公开时间，团队在公开前仅对已登录管理员和通过有效提前报名链接进入的用户可见；填写公开时间后到点自动公开，时间留空则持续不公开。公开时间按北京时间填写，也可以在团队设置中修改；取消勾选后立即公开。

顶部“提前报名”用于复制或重新生成共享链接，重生成后旧链接失效。公开时间分别保存在每个团队中，复制、归档和恢复团队时都会保留。升级时会将原先的全局公开时间迁移到已有团队。

## 验证

```bash
npm run test
npm run lint
npm run build
npm run backend:build
npm --prefix qqbot ci
npm --prefix qqbot run test:client
npm run test:backend
npm run test:docker
```

`test:backend` 会启动真实 C++ 后端，使用工作区 `.temp/` 下的隔离数据库和管理员配置，验证旧库迁移、机器人接口、并发报名及版本同步。

## 并发压测

```bash
npm run bench:concurrency
```

该命令会启动一个使用 `.temp/` 下临时 SQLite 数据库及独立管理员配置的后端，然后运行 C++ 压测程序模拟 30 人同时报名不同表格/格子，以及 30 人同时抢同一个格子的内存锁冲突场景。压测结束后自动清理临时数据。可用 `BENCH_CLIENTS=30`、`BENCH_PORT=23961` 调整参数。
