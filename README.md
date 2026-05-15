# TeamAssistant

TeamAssistant 已拆分为独立 React/Vite 前端和 Drogon/SQLite C++ 后端。

## 目录

- `frontend/`: 前端应用、Vite 配置和前端测试。
- `backend-cpp/`: C++ 后端、CMake 配置和本地依赖源码。
- `docs/`: API v2 与迁移说明。
- `scripts/`: 根目录调度脚本。

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

## 验证

```bash
npm run test
npm run build
npm run backend:build
```

## 并发压测

```bash
npm run bench:concurrency
```

该命令会启动一个使用临时 SQLite 数据库的后端，然后运行 C++ 压测程序模拟 30 人同时报名不同表格/格子，以及 30 人同时抢同一个格子的内存锁冲突场景。可用 `BENCH_CLIENTS=30`、`BENCH_PORT=23961` 调整参数。
