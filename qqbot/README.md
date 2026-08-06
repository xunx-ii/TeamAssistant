# QQ 机器人模板（pi-coding-agent × qqbot-connector）

基于 [pi coding agent](https://pi.dev)（`@earendil-works/pi-coding-agent`）与腾讯 QQ 机器人生态（`@tencent-connect/qqbot-connector` + `@tencent-connect/qqbot-nodejs`）的 AI QQ 机器人模板：

- **扫码即用**：`npm run bind` 控制台生成二维码，手机 QQ 扫码自动获取机器人 AppID/AppSecret，无需手动配置
- **AI 大脑**：对话由 pi 编码智能体驱动，支持工具调用（读写文件、执行命令），可在群里@它干活
- **持久记忆**：对话历史存入 SQLite（`data/qqbot.db`），机器人重启后通过历史注入恢复上下文
- **双场景**：支持私聊（C2C）与群聊（@触发）

## 架构

```
       手机 QQ 扫码                    QQ 开放平台网关
            │  ┌────────────────┐            │
 npm run bind│  │ qqbot-connector│            │
            └─▶│ 扫码获取凭据    │──AppID/Secret──▶ credentials.json
               └────────────────┘                    │
                                                     ▼
      用户消息 ──▶  qqbot-nodejs SDK ──▶ index.js 消息分发
       （WS 网关）  （官方 SDK：心跳/重连）      │
                                             ▼
                                  ┌────────────────────┐
                                  │  pi AgentSession    │
                                  │  （每对话一个）      │
                                  │  ◄── 历史注入(记忆)  │
                                  └────────┬───────────┘
                                           │ 每轮消息落库
                                           ▼
                                     SQLite (node:sqlite)
```

## 快速开始

### 0. 环境要求

- Node.js ≥ 22.5（模板使用内置 `node:sqlite` 与原生 WebSocket，推荐 Node 24+）
- 一个 QQ 开放平台的机器人应用（[q.qq.com](https://q.qq.com)），并在「开发设置」中开通 **单聊** / **群聊** 权限

### 1. 安装依赖

```bash
npm install
cp .env.example .env
```

### 2. 配置 AI 模型（三选一）

**方式 A：API Key（推荐）**

在 `.env` 中填写所用 provider 的 Key，例如：

```ini
DEEPSEEK_API_KEY=sk-xxx
PI_MODEL=deepseek/deepseek-chat
```

pi 支持 anthropic / openai / deepseek / google / xai / groq 等多家（见 `src/config.js` 的 `API_KEY_ENV`）。

**方式 B：使用 pi 登录凭据**

若已用过 pi 客户端（`pi /login`），`~/.pi/agent/auth.json` 中已有凭据，无需任何配置。

**方式 C：自定义模型（不依赖内置运营商）**

对接本地或自建服务（Ollama、vLLM、LM Studio、代理网关等）：

```ini
CUSTOM_BASE_URL=http://localhost:11434/v1   # BaseURL
CUSTOM_API=openai-completions               # 协议：openai-completions / openai-responses / anthropic-messages / google-generative-ai
CUSTOM_API_KEY=sk-xxx                       # API Key（以 $CUSTOM_API_KEY 形式注入 models.json，不落盘）
CUSTOM_MODEL=qwen2.5-coder:7b               # 模型名称
CUSTOM_CONTEXT=65536                        # 上下文大小（tokens）
CUSTOM_IMAGES=true                          # 是否支持图片输入
```

启动时自动生成 pi 的 models.json（`data/pi-models.json`）。`PI_MODEL` 可写为 `custom/qwen2.5-coder:7b` 指定该模型，或留空让 pi 自动选择。更复杂的多 provider 场景可直接用 `PI_MODELS_FILE` 指向已有 models.json（格式见 [pi 文档](node_modules/@earendil-works/pi-coding-agent/docs/models.md)）。

### 3. 扫码绑定机器人

```bash
npm run bind
```

控制台会打印二维码，用手机 QQ 扫码即可。绑定成功后凭据自动保存到 `credentials.json`（已 gitignore）。

### 4. 启动

```bash
npm start
```

默认运行在**沙箱环境**（`QQ_ENV=sandbox`），此时只有沙箱用户能触发机器人。验证通过后把 `.env` 中 `QQ_ENV` 改为 `production` 即可上线。

## 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `QQ_ENV` | `sandbox` | `sandbox`（沙箱）/ `production`（正式） |
| `QQ_APP_ID` / `QQ_APP_SECRET` | — | 凭据（优先于 `credentials.json`） |
| `QQ_BASE_URL` | 按环境自动 | 覆盖 QQ OpenAPI 域名 |
| `PI_MODEL` | 自动选择 | 模型，格式 `provider/model-id`，如 `anthropic/claude-sonnet-4-5`、`custom/qwen2.5-coder:7b` |
| `ANTHROPIC_API_KEY` 等 | — | 模型 API Key（anthropic/openai/deepseek/google/xai/groq…） |
| `CUSTOM_BASE_URL` | — | 自定义模型 BaseURL（配置后自动生成 pi models.json） |
| `CUSTOM_API` | `openai-completions` | 自定义模型协议：`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai` |
| `CUSTOM_API_KEY` | — | 自定义模型 API Key |
| `CUSTOM_MODEL` | — | 自定义模型名称（id） |
| `CUSTOM_NAME` | 同模型名 | 自定义模型显示名 |
| `CUSTOM_CONTEXT` | `128000` | 自定义模型上下文大小（tokens） |
| `CUSTOM_MAX_TOKENS` | `16384` | 自定义模型最大输出（tokens） |
| `CUSTOM_IMAGES` | `false` | 自定义模型是否支持图片输入 |
| `CUSTOM_REASONING` | `false` | 自定义模型是否支持思考/推理 |
| `CUSTOM_HEADERS` | — | 自定义请求头（JSON 对象） |
| `PI_MODELS_FILE` | — | 直接指定已有 models.json 文件（多 provider 完全自定义，优先级高于 `CUSTOM_*`） |
| `BOT_PROMPT` | 默认人设 | 机器人人设提示词 |
| `BOT_TOOLS` | 全部内置工具 | 工具白名单（逗号分隔），如 `BOT_TOOLS=read,grep,find,ls` 可设为只读 |
| `BOT_HISTORY_LIMIT` | `20` | 重启后注入的历史消息条数 |
| `BOT_MAX_CONCURRENCY` | `2` | 上游 API 最大并发数（同时执行的生成请求数，超出按到达顺序排队） |
| `BOT_USER_RATE_LIMIT` | `3` | 每个对话两次请求的最小间隔（秒），`0` 不限速 |
| `BOT_QUEUE_TIMEOUT` | `60` | 排队等待上限（秒），超时回复"机器人正忙" |
| `BOT_QUEUE_LIMIT` | `20` | 排队中的最大请求数，超过直接回复"机器人正忙" |

## 项目结构

```
├── src/
│   ├── index.js    # 入口：凭据校验 → 连接 QQ 网关 → 消息分发
│   ├── bind.js     # 扫码绑定（npm run bind）
│   ├── config.js   # 环境变量与凭据解析
│   ├── db.js       # SQLite 存储（node:sqlite，零依赖）
│   ├── qq.js       # QQ 官方 SDK 封装（收发消息、打字指示器）
│   └── agent.js    # pi 会话管理（每对话一个 AgentSession + 记忆注入）
├── .env.example    # 配置模板
└── credentials.json # 扫码凭据（自动生成，勿提交）
```

## 工作原理

### 扫码绑定（qqbot-connector）

`bind.js` 调用 `qrConnect()`：在控制台渲染二维码，轮询扫码结果，成功后返回 `{ appId, appSecret }` 并写入 `credentials.json`。

### 消息收发（qqbot-nodejs）

消息通道使用腾讯官方 SDK `@tencent-connect/qqbot-nodejs`（与 `qqbot-connector` 同属 tencent-connect 组织）。SDK 负责 access_token 获取与缓存、WebSocket 网关连接、心跳、断线自动续连（RESUME）、限流退避。收到 `C2C_MESSAGE_CREATE`（私聊）或 `GROUP_AT_MESSAGE_CREATE`（群 @）时触发 `message` 事件。

### AI 对话（pi-coding-agent）

- 每个对话（私聊用户 / 群）对应一个**常驻内存**的 pi `AgentSession`，保持多轮对话上下文
- 每轮消息与回复实时写入 SQLite；重启后从 SQLite 取最近 N 条历史，通过 `appendSystemPromptOverride` 注入新会话，实现跨重启记忆
- 回复采用流式订阅收集，生成完成后一次性发送（私聊会先显示"对方正在输入"）

### 多用户流控

机器人面向多用户时，不同对话的生成请求会并发打到上游 API。模板内置三层流控（`src/limiter.js` + `handleMessage`）：

1. **用户级限速**（`BOT_USER_RATE_LIMIT`）：每个对话两次请求的最小间隔，基于消息到达时间判断（不受排队时长影响），超限直接回复"请 X 秒后再试"——防止单用户刷屏
2. **对话内串行**：同一对话的消息在 busy 链上排队，避免 pi 会话状态冲突
3. **全局并发**（`BOT_MAX_CONCURRENCY`）：信号量限制同时执行的上游生成请求数，超出部分按到达顺序 FIFO 排队；`BOT_QUEUE_LIMIT` 限制排队长度、`BOT_QUEUE_TIMEOUT` 限制排队时长，超限回复"机器人正忙"

### 自定义模型（models.json）

pi 不强制使用内置运营商：配置 `CUSTOM_*` 后，启动时生成 `data/pi-models.json` 并传给 `ModelRuntime.create({ modelsPath })`，模型即注册为 `custom` provider。生成内容支持：

- **BaseURL**：`CUSTOM_BASE_URL`
- **协议类型**：`CUSTOM_API`（OpenAI 兼容 / Anthropic Messages / Google Generative AI）
- **API Key**：以 `$CUSTOM_API_KEY` 环境变量插值写入（明文不落盘）；免鉴权服务（如 Ollama）可不配置
- **模型名称 / 显示名**：`CUSTOM_MODEL` / `CUSTOM_NAME`
- **上下文大小**：`CUSTOM_CONTEXT` → `contextWindow`
- **图片支持**：`CUSTOM_IMAGES=true` → `input: ["text", "image"]`

`PI_MODEL=custom/<模型名>` 可精确指定该模型；`PI_MODELS_FILE` 可直接指向完整 models.json（可自定义多个 provider、请求头、成本等，格式见 `node_modules/@earendil-works/pi-coding-agent/docs/models.md`）。

## 安全提示

- `credentials.json` 与 `.env` 包含机器人密钥，切勿提交或外泄
- pi 默认带 `bash` 工具，**任何给机器人发消息的人都可能让它执行命令**（文件操作发生在机器人进程的工作目录）。仅对可信用户开放，或通过 `BOT_TOOLS` 收窄为只读工具
- 模型 API Key 消耗对应额度，注意用量

## 团队报名指令（TeamAssistant）

机器人可对接你的 [TeamAssistant 后端](docs/api-v2.md)（`backend-cpp`，Drogon + SQLite），玩家在群里 @ 机器人或私聊直接发指令报名：

| 指令 | 说明 |
|------|------|
| `/绑定 <昵称> <QQ号>` | 绑定昵称和真实 QQ 号（首次使用必做；昵称可省略，省略时自动从后端 userProfiles **同步昵称**；重复绑定直接更新） |
| `/解绑` | 解除绑定 |
| `/报名 <团队> <角色名> <武学> [装分] [#槽位]` | 报名（武学必填），自动选第一个空槽位，也可 `#N` 指定 |
| `/退出 <团队>` | 退出该团队报名（清空槽位） |
| `/团队 [名称]` | 团队列表 / 团队详情 |
| `/帮助` | 指令帮助 |

**管理员 QQ 绑定保护**：绑定前机器人会调后端 `/admin/check` 检测目标 QQ 是否为管理员（`admin.json` 列表）：

- 普通 QQ：群聊/私聊均可直接绑定
- 管理员 QQ：**群里绑定会被拒绝**（提示只能私聊绑定）；私聊绑定需输入**管理员密码**（调后端 `/admin/login` 验证，60 秒有效、最多 3 次尝试，验证期间发任意非指令消息即视为提交密码）

> ⚠️ 管理员密码会在 QQ 聊天中明文传输，注意该风险；绑定成功后请尽快结束验证状态。

- 报名/退出走后端**槽位锁**流程（获取锁 → 写入 → 释放），冲突原因自动翻译成中文提示（槽位被改、团队锁定、武学限制、重复报名等）
- 武学支持「门派·心法」「心法名」「下标数字」三种写法（如 `天策·傲血战意` / `傲血战意` / `0`），数据见 `src/martial-arts.js`
- 指令消息不会进入 AI 闲聊，也不占用 pi 的生成并发

### 团队报名配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `TEAMASSISTANT_BASE_URL` | `http://127.0.0.1:23219/api/v2` | 后端地址（见 docs/api-v2.md） |
| `TEAMASSISTANT_INVITE_TOKEN` | 空 | 门禁关闭时的邀请码 |
| `QQ_MARKDOWN` | `false` | 开启后 `/团队 <名称>` 详情以 **5×5 markdown 表格**输出（25 槽位列优先网格，每格显示「心法\|角色」）；需先在 QQ 开放平台开通 markdown 消息权限，否则发送会失败 |

角色以 emoji 标记（QQ markdown 不支持字体颜色）：**老板 💰 / 奶妈 💗 / DPS ⚔ / T 🛡**；固定心法槽位显示「预留\|心法」、老板位显示「预留\|老板」。

## 常见问题

- **扫码后提示失败**：确认手机 QQ 已登录，且机器人应用已在开放平台通过审核/开通相应权限
- **正式环境收不到消息**：确认 `QQ_ENV=production`，且在开放平台开通了单聊/群聊消息权限
- **启动报模型不可用**：检查 `.env` 中的 API Key 与 `PI_MODEL` 拼写；可先不填 `PI_MODEL` 让 pi 自动选择
- **重启后记忆不生效**：确认 `data/qqbot.db` 存在，且 `BOT_HISTORY_LIMIT` 未设为 0

## License

MIT
