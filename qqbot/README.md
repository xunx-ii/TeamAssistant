# TeamAssistant OpenQQ 机器人

TeamAssistant 的 QQ 通道使用 [OpenQQ](https://github.com/feijx3/OpenQQ) 提供的 OneBot v11 正向 WebSocket。机器人直接使用 QQ 原生号，不再依赖 QQ 官方 Bot AppID、AppSecret 或扫码绑定。

## 成员权限

- 目标群固定为 `1013228497`，可通过 `TEAMASSISTANT_QQ_GROUP_ID` 修改。
- 启动时、定时任务以及入群、退群、群名片和管理员变更事件后，机器人都会通过 `get_group_member_list` 拉取完整成员列表。
- 群成员列表会原子同步到 TeamAssistant 后端白名单，并同步群名片/昵称到 `user_profiles`。
- 退群成员会立即失去会员会话和新登录权限，机器人不会在群内公开播报退群成员身份。
- 网站只允许输入 QQ 号登录。非群成员会收到“请先加入 QQ 群”的提示。
- 机器人指令直接使用 OneBot 事件中的真实 `user_id`，不需要绑定 QQ。
- 群聊中先 @机器人，再直接发送指令，不需要 `/` 前缀。

## 环境变量

```dotenv
OPENQQ_WS_URL=ws://host.docker.internal:3001/
OPENQQ_ACCESS_TOKEN=从 OpenQQ WebUI 连接页复制
TEAMASSISTANT_QQ_GROUP_ID=1013228497
TEAMASSISTANT_GROUP_SYNC_INTERVAL_MS=60000
TEAMASSISTANT_BOT_TOKEN=至少16位的随机内部服务令牌
TEAMASSISTANT_BASE_URL=http://127.0.0.1:23219/api/v2
```

`OPENQQ_ACCESS_TOKEN` 用于连接 OpenQQ，`TEAMASSISTANT_BOT_TOKEN` 用于机器人与 TeamAssistant 后端之间的受保护同步接口，两者应不同。

## 指令

| 群员指令 | 说明 |
|---|---|
| `报名 <团队> <角色名> <武学> [装分] [#槽位]` | 装分可省略，省略时报名列表不显示装分 |
| `取消 <团队> [原因]` | 取消报名并记录原因，可进入网站取消记录 |
| `退出 <团队> [原因]` | `取消` 的兼容别名 |
| `我的报名 [团队]` | 查看自己当前报名的槽位，也支持“帮我看看我的报名情况”等自然表达 |
| `团队 [名称]` | 查看团队列表或详情 |
| `帮助` | 查看全部指令 |

| 管理员指令 | 说明 |
|---|---|
| `开团 <名称> [周YYYY-MM-DD]` | 快速创建 25 个空槽位的团队，默认使用本周 |
| `改名 <团队> <新名称>` | 修改团队名称 |
| `删团 <团队>` | 删除团队，删除最后一个团队时自动创建默认团队 |
| `锁定 <团队>` | 暂停团队报名 |
| `解锁 <团队>` | 恢复团队报名 |
| `代取消 <团队> <QQ> [原因]` | 管理员代群员取消并记录原因 |
| `快速预留 <团队> <T\|治疗\|DPS\|老板> [数量] [武学]` | 批量预留槽位，DPS 必须指定具体武学 |
| `设置规则 <团队> <仅T奶\|取消仅T奶\|唯一QQ\|取消唯一QQ>` | 修改报名规则 |

管理员身份由后端管理员名单实时校验。团队名包含空格时可以用英文引号包裹。私聊只处理该 QQ 仍在目标群内的成员。

OneBot 群消息中的真实发送者 QQ 会同时传给报名指令和 AI 上下文。需要查询本人数据时不会再次要求用户提供 QQ 号。

## 本地启动

```bash
npm ci
npm run test:client
npm test
npm start
```

OpenQQ 容器必须开启正向 WebSocket，并允许 TeamAssistant 容器访问。默认 Compose 已添加 `host.docker.internal:host-gateway`，同一 Docker 网络也可将 `OPENQQ_WS_URL` 改为 `ws://openqq:3001/`。

## 故障排查

- 连接被拒绝时，检查 OpenQQ 的 `3001` 端口、容器网络和 `OPENQQ_ACCESS_TOKEN`。
- 登录提示“不在群中”时，检查 OpenQQ 是否已登录、目标群是否可读取成员列表，以及后端日志中的 `[membership]` 输出。
- `get_group_member_list` 失败时不会清空白名单，已有成员会话继续按最近一次成功快照生效。
- 修改群成员后通常约 1 秒触发增量刷新，另有默认 60 秒全量兜底同步。
