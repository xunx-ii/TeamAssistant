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

## 验证

```bash
npm run test
npm run build
npm run backend:build
```
