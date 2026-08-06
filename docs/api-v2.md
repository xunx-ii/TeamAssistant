# TeamAssistant C++ Backend API v2 使用手册

本文档描述 `backend-cpp` 当前实际提供的 HTTP API。接口由 Drogon 实现，数据存储在 SQLite，适用于前端、脚本和其他后端服务调用。

接口注册和权限判断以 [`backend-cpp/src/main.cpp`](../backend-cpp/src/main.cpp) 为最终准则；如果本文档与源码不一致，应优先以源码行为为准。

## 1. 服务概览

### 1.1 基础地址

后端默认监听 `0.0.0.0:23219`：

```text
http://127.0.0.1:23219/api/v2
```

开发环境启动 Vite 后，也可以使用代理地址：

```text
http://127.0.0.1:5173/api/v2
```

Vite 会把 `/api/v2` 转发到 `VITE_API_PROXY_TARGET`，默认值为 `http://127.0.0.1:23219`。

### 1.2 编译和启动

在项目根目录执行：

```powershell
npm install
npm run backend:configure
npm run backend:build
npm run backend:serve
```

前后端一起启动：

```powershell
npm run dev
```

启动参数通过环境变量配置：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `23219` | HTTP 监听端口 |
| `TEAMASSISTANT_DB` | `backend-cpp/data/teamassistant.sqlite3` | SQLite 数据库路径 |
| `TEAMASSISTANT_ADMIN_CONFIG` | `backend-cpp/admin.json` | 管理员配置文件路径 |
| `TEAMASSISTANT_ADMIN_PASSWORD` | 空 | 管理员明文密码，仅建议通过环境变量注入 |
| `TEAMASSISTANT_ADMIN_PASSWORD_SALT` | 空 | 管理员密码盐值 |
| `TEAMASSISTANT_ADMIN_PASSWORD_HASH` | 空 | `SHA-256(salt + password)` 的大写十六进制值 |

例如：

```powershell
$env:PORT = "23219"
$env:TEAMASSISTANT_DB = "D:\data\teamassistant.sqlite3"
$env:TEAMASSISTANT_ADMIN_PASSWORD = "请替换为强密码"
npm run backend:serve
```

也可以生成密码哈希并写入 `admin.json`：

```powershell
node scripts/admin-password-hash.mjs "请替换为强密码"
```

`admin.json` 至少需要配置管理员 QQ：

```json
{
  "adminQQs": ["89906502", "2722788501"]
}
```

### 1.3 请求约定

- JSON 请求使用 `Content-Type: application/json`，编码为 UTF-8。
- 所有时间戳均为 Unix 毫秒时间戳。
- `teamId`、`archiveId`、QQ 和备份文件名应进行 URL 编码。
- 槽位下标 `slotIndex` 范围为 `0` 到 `24`，每个团队固定 25 个槽位。
- 武学下标 `martialArtIndex` 为前端武学数组的 0-based 下标，范围为 `0` 到 `31`。
- 成功响应通常包含 `ok: true`；失败响应包含 `ok: false`，并尽量提供稳定的 `reason`。
- API 支持 CORS，并允许 `Content-Type`、`Authorization`、`X-Requested-With` 请求头。

管理员 Token 可以放在以下任意位置：

```http
Authorization: Bearer <adminToken>
```

```json
{
  "actorQq": "89906502",
  "adminToken": "<adminToken>"
}
```

或者放在查询参数 `adminToken` 中。生产环境优先使用 `Authorization` 请求头；下载、历史查询等 GET 请求仍需要通过查询参数传入 `actorQq`，Token 可以继续使用请求头。

## 2. 统一响应和权限模型

### 2.1 版本号

```json
{
  "ok": true,
  "dataVersion": 12,
  "lockVersion": 8
}
```

- `dataVersion`：SQLite 中持久化的数据版本，每次数据变更递增。
- `lockVersion`：当前进程内存锁版本，后端重启后会重新从 1 开始。
- 槽位锁和运行时团队锁都只存在内存中，重启后不会恢复。

### 2.2 管理员权限

管理员请求必须同时满足：

1. `actorQq` 在 `admin.json` 的管理员列表中。
2. `adminToken` 是当前后端进程签发且尚未过期的 Token。

管理员登录 Token 有效期为 12 小时，后端重启后全部失效。

### 2.3 本人或管理员权限

以下类型的接口允许目标用户本人操作，也允许管理员代操作：

- 槽位成员保存、退出、取消报名；
- 删除取消记录；
- 登记团队或归档团队的补贴。

本人操作时，请保证请求体的 `actorQq` 与路径中的目标 QQ 一致。管理员代操作时，`actorQq` 应填写管理员 QQ，并携带有效 Token。

### 2.4 访问门禁

门禁开放条件为：

```text
publicAtMs <= 0 || 当前时间 >= publicAtMs
```

门禁关闭时，管理员或携带正确 `inviteToken` 的请求仍然可以访问受保护数据。

## 3. 数据结构

### 3.1 团队

```json
{
  "id": "team-1",
  "name": "周常一团",
  "note": "",
  "weekStart": "2026-08-03",
  "config": {
    "reservedSlots": [20, 21],
    "locked": false,
    "onlyTnSignup": false,
    "uniqueQqSignup": false
  },
  "slots": []
}
```

服务端会把团队规范化为 25 个槽位。团队名称最多保留 40 个 Unicode 字符，连续空白会被压缩。

### 3.2 槽位

```json
{
  "index": 0,
  "status": "occupied",
  "member": {
    "qq": "10001",
    "martialArtIndex": "0",
    "gearScore": "12000",
    "characterId": "角色名",
    "note": "",
    "hasOrangeWeapon": false
  },
  "fixedRole": null,
  "fixedMartialArtIndex": null
}
```

`status` 支持：

| 状态 | 含义 |
|---|---|
| `empty` | 空槽位 |
| `occupied` | 已有报名成员 |
| `reserved` | 团长预留槽位 |
| `fixed` | 固定了角色或武学限制的槽位 |

成员字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `qq` | string | 成员 QQ，保存时必填 |
| `martialArtIndex` | string | 武学下标，服务端用于角色限制校验 |
| `gearScore` | string | 装分 |
| `characterId` | string | 角色标识或角色名 |
| `note` | string | 备注 |
| `hasOrangeWeapon` | boolean | 是否有橙武，可选 |

### 3.3 补贴

```json
{
  "id": "gold",
  "name": "金币补贴",
  "levels": [
    { "name": "普通", "gold": 1000 },
    { "name": "高级", "gold": 2000 }
  ]
}
```

成员补贴选择：

```json
{
  "typeId": "gold",
  "levelName": "普通",
  "weekStart": "2026-08-03"
}
```

## 4. 管理员登录和门禁 API

### 4.1 检查管理员 QQ

```http
GET /api/v2/admin/check?actorQq=89906502
```

响应：

```json
{
  "ok": true,
  "isAdmin": true,
  "passwordConfigured": true
}
```

### 4.2 管理员登录

```http
POST /api/v2/admin/login
Content-Type: application/json
```

```json
{
  "actorQq": "89906502",
  "password": "管理员密码"
}
```

成功响应：

```json
{
  "ok": true,
  "isAdmin": true,
  "adminToken": "随机 Token",
  "expiresAtMs": 1780000000000
}
```

失败时可能返回：

| `reason` | 含义 |
|---|---|
| `forbidden` | QQ 不在管理员列表中 |
| `adminPasswordMissing` | 后端没有配置密码 |
| `invalidPassword` | 密码错误 |

### 4.3 管理员退出

```http
POST /api/v2/admin/logout
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502"
}
```

### 4.4 查询门禁

```http
GET /api/v2/access-gate?actorQq=89906502
Authorization: Bearer <adminToken>
```

响应中会包含当前邀请码，因为这是管理员接口：

```json
{
  "ok": true,
  "publicAtMs": 0,
  "isOpen": true,
  "authorized": true,
  "requiresInvite": false,
  "hasInviteToken": true,
  "inviteToken": "邀请码",
  "updatedAtMs": 1780000000000,
  "updatedBy": "89906502"
}
```

### 4.5 设置开放时间

```http
PUT /api/v2/access-gate
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502",
  "publicAtMs": 1780000000000
}
```

设置 `publicAtMs: 0` 可以立即开放报名。

### 4.6 重新生成邀请码

```http
POST /api/v2/access-gate/token
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502"
}
```

旧邀请码会立即失效，成功响应会返回新的 `inviteToken`。

## 5. 查询和同步 API

### 5.1 查询版本

```http
GET /api/v2/version
```

### 5.2 获取初始快照

```http
GET /api/v2/bootstrap?qq=10001&inviteToken=<inviteToken>
```

响应包含：

- `teams`
- `cancellations`
- `archivedTeams`
- `logs`
- `userProfiles`
- `subsidyPresets`
- `locks`
- `teamLocks`
- `dataVersion`
- `lockVersion`
- `isAdmin`
- `accessGate`

为了限制初始响应大小，快照默认最多返回最近 200 条取消记录和 500 条操作日志，并提供：

```json
{
  "cancellationsTotal": 250,
  "cancellationsTruncated": true,
  "logsTotal": 600,
  "logsTruncated": true
}
```

门禁关闭且未授权时，`bootstrap` 仍然返回 HTTP 200，但只返回受保护的团队基础信息和补贴相关信息，不返回完整槽位数据。

### 5.3 增量同步

```http
GET /api/v2/sync?dataVersion=12&lockVersion=8&qq=10001&inviteToken=<inviteToken>
```

响应示例：

```json
{
  "ok": true,
  "dataVersion": 14,
  "lockVersion": 9,
  "isAdmin": false,
  "dataChanged": true,
  "lockChanged": true,
  "patches": [],
  "locks": {
    "slots": [],
    "teams": [],
    "lockVersion": 9
  }
}
```

处理规则：

1. `dataChanged: false` 时不更新业务数据。
2. `lockChanged: false` 时不更新锁数据。
3. 如果返回 `data`，以 `data` 作为完整快照。
4. 如果只返回 `patches`，按 `dataVersion` 升序依次应用。
5. 客户端版本落后太多、无法使用缓存补丁时，服务端会返回完整 `data`。

### 5.4 查询运行时锁

```http
GET /api/v2/locks?qq=10001&inviteToken=<inviteToken>
```

返回：

```json
{
  "slots": [
    {
      "teamId": "team-1",
      "slotIndex": 0,
      "qq": "10001",
      "timestamp": 1780000000000
    }
  ],
  "teams": [
    {
      "teamId": "team-2",
      "timestamp": 1780000000000
    }
  ],
  "lockVersion": 9
}
```

锁对象不会返回 `lockToken`，Token 只在获取锁的响应中返回给持有者。

### 5.5 SSE 事件

```http
GET /api/v2/events
Accept: text/event-stream
```

连接建立后会收到 `hello` 事件，数据变更或锁变化时收到 `version` 事件：

```text
event: version
data: {"ok":true,"type":"version","dataVersion":14,"lockVersion":9}
```

SSE 只负责通知版本变化，不携带完整业务数据。收到事件后，应调用 `/sync`。

### 5.6 历史分页

日志和取消记录查询也受访问门禁保护。门禁关闭时，请携带正确的 `inviteToken`；管理员请求则携带 `actorQq` 和管理员 Token。

操作日志：

```http
GET /api/v2/logs?teamId=team-1&before=1780000000000&limit=200
```

取消记录：

```http
GET /api/v2/cancellations?qq=10001&before=1780000000000&limit=200
```

响应格式：

```json
{
  "ok": true,
  "items": [],
  "hasMore": true,
  "nextCursor": 1779999000000,
  "limit": 200
}
```

下一页请求时，把上一次响应的 `nextCursor` 作为新的 `before`。服务端会把 `limit` 限制在 1 到 500 之间。

## 6. 团队管理 API

以下接口均要求管理员权限。

### 6.1 创建团队

```http
POST /api/v2/teams
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502",
  "team": {
    "id": "team-1",
    "name": "周常一团",
    "note": "",
    "weekStart": "2026-08-03",
    "config": {
      "reservedSlots": [],
      "locked": false,
      "onlyTnSignup": false,
      "uniqueQqSignup": false
    },
    "slots": []
  }
}
```

`slots` 可以为空，服务端会自动创建 25 个空槽位。

成功响应通常为：

```json
{
  "ok": true,
  "dataVersion": 13,
  "lockVersion": 9
}
```

### 6.2 批量创建团队

```http
POST /api/v2/teams/batch
```

```json
{
  "actorQq": "89906502",
  "teams": [
    { "id": "team-1", "name": "一团", "config": {}, "slots": [] },
    { "id": "team-2", "name": "二团", "config": {}, "slots": [] }
  ]
}
```

一次最多创建 50 个团队，整个批次在一个 SQLite 事务中执行。

### 6.3 修改团队

```http
PATCH /api/v2/teams/{teamId}
```

请求体支持以下字段：

```json
{
  "actorQq": "89906502",
  "name": "新团队名称",
  "note": "团队备注",
  "weekStart": "2026-08-03",
  "onlyTnSignup": true,
  "uniqueQqSignup": false
}
```

字段可以只传需要修改的部分。

### 6.4 删除团队

```http
DELETE /api/v2/teams/{teamId}
```

```json
{
  "actorQq": "89906502",
  "fallbackTeam": {
    "id": "default-team",
    "name": "默认团队",
    "config": {},
    "slots": []
  }
}
```

如果删除后已经没有团队，且提供了 `fallbackTeam`，服务端会自动创建备用团队。

### 6.5 团队排序

```http
POST /api/v2/teams/reorder
```

```json
{
  "actorQq": "89906502",
  "ids": ["team-2", "team-1"]
}
```

### 6.6 归档和恢复

归档：

```http
POST /api/v2/teams/{teamId}/archive
```

```json
{
  "actorQq": "89906502",
  "archivedBy": "89906502",
  "archivedAt": 1780000000000,
  "fallbackTeam": {}
}
```

`archivedAt` 小于等于 0 时由服务端生成当前时间。归档后团队从活动团队列表中移除，并写入 `archivedTeams`。

恢复：

```http
POST /api/v2/archives/{archiveId}/restore
```

```json
{
  "actorQq": "89906502",
  "restoredAt": 1780000000000
}
```

### 6.7 团队配置锁

```http
PATCH /api/v2/teams/{teamId}/lock-state
```

```json
{
  "actorQq": "89906502",
  "locked": true
}
```

该接口修改团队 `config.locked` 持久化字段。

### 6.8 设置槽位角色

```http
PUT /api/v2/teams/{teamId}/slots/{slotIndex}/role
```

固定角色：

```json
{
  "actorQq": "89906502",
  "role": "T",
  "martialArtIndex": null,
  "assignQQ": ""
}
```

固定具体武学：

```json
{
  "actorQq": "89906502",
  "role": "DPS",
  "martialArtIndex": 0,
  "assignQQ": ""
}
```

直接指定成员：

```json
{
  "actorQq": "89906502",
  "role": "DPS",
  "martialArtIndex": 0,
  "assignQQ": "10001"
}
```

`role` 为 `boss` 时会把槽位加入 `reservedSlots`；清除角色时传 `role: null`，并将 `assignQQ` 置为空字符串。

### 6.9 快速预留

```http
POST /api/v2/teams/{teamId}/quick-reserve
```

```json
{
  "actorQq": "89906502",
  "reserveType": "治疗",
  "count": 2,
  "martialArtIndex": null
}
```

`reserveType` 支持：`T`、`治疗`、`DPS`、`boss`。DPS 预留必须传有效的 DPS 武学下标。`count` 会被限制在 0 到 25 之间。

### 6.10 运行时团队锁

加锁：

```http
POST /api/v2/team-locks
```

```json
{
  "actorQq": "89906502",
  "teamId": "team-1"
}
```

解锁：

```http
DELETE /api/v2/team-locks/{teamId}?actorQq=89906502
Authorization: Bearer <adminToken>
```

运行时团队锁存在于内存中，适合在团队配置或批量操作期间暂时阻止槽位锁竞争。

## 7. 槽位锁和报名 API

报名写入必须按照“获取锁、写入、释放”的顺序执行。

获取锁、校验锁、保存成员、退出报名和取消报名都需要通过访问门禁。门禁开放时不需要邀请码；门禁关闭时，可以在查询参数或 JSON 请求体中加入 `inviteToken`。管理员也可以使用管理员 QQ 和有效 Token 通过门禁。

### 7.1 获取槽位锁

```http
POST /api/v2/slot-locks
```

```json
{
  "teamId": "team-1",
  "slotIndex": 0,
  "qq": "10001"
}
```

成功响应：

```json
{
  "ok": true,
  "timestamp": 1780000000000,
  "lockToken": "1780000000000-1",
  "lockVersion": 10
}
```

槽位已经被其他 QQ 占用时：

```json
{
  "ok": false,
  "lockedBy": "10002",
  "lockedAt": 1780000000000
}
```

锁超时为 60 秒。持锁期间可以调用校验接口：

```http
POST /api/v2/slot-locks/validate
```

```json
{
  "teamId": "team-1",
  "slotIndex": 0,
  "qq": "10001",
  "lockToken": "1780000000000-1"
}
```

### 7.2 释放槽位锁

```http
DELETE /api/v2/slot-locks/{teamId}/{slotIndex}
```

```json
{
  "qq": "10001",
  "lockToken": "1780000000000-1"
}
```

释放接口是幂等的最佳努力操作，锁已经不存在时仍返回 `ok: true`。

### 7.3 保存报名成员

```http
PUT /api/v2/teams/{teamId}/slots/{slotIndex}/member
```

```json
{
  "qq": "10001",
  "actorQq": "10001",
  "lockToken": "1780000000000-1",
  "expectedMemberQq": null,
  "member": {
    "qq": "10001",
    "martialArtIndex": "0",
    "gearScore": "12000",
    "characterId": "角色名",
    "note": "",
    "hasOrangeWeapon": false
  }
}
```

`expectedMemberQq` 用于乐观并发控制：

- 空槽位报名时传 `null` 或省略；
- 修改已有成员时传当前成员 QQ；
- 如果当前值与预期不一致，返回 `reason: slotChanged`，不会覆盖其他人的修改。

保存成功后，服务端会在一个短事务中完成：校验锁、校验槽位、写入成员、写操作日志、递增 `dataVersion`、释放锁并递增 `lockVersion`。

### 7.4 退出报名

```http
DELETE /api/v2/teams/{teamId}/slots/{slotIndex}/member
```

```json
{
  "actorQq": "10001",
  "lockToken": "1780000000000-1",
  "expectedMemberQq": "10001"
}
```

### 7.5 取消报名

```http
POST /api/v2/teams/{teamId}/slots/{slotIndex}/cancel
```

```json
{
  "actorQq": "10001",
  "cancelledBy": "10001",
  "reason": "临时有事",
  "lockToken": "1780000000000-1",
  "expectedMemberQq": "10001"
}
```

取消操作会写入 `cancellations` 和 `operation_logs`。取消记录的最终时间戳由服务端生成，请不要依赖客户端传入的时间戳。

### 7.6 删除取消记录

```http
DELETE /api/v2/cancellations/{qq}/{timestamp}
Content-Type: application/json
```

本人删除：

```json
{
  "actorQq": "10001"
}
```

管理员删除时，`actorQq` 填管理员 QQ 并携带管理员 Token。

## 8. 用户资料 API

### 8.1 修改昵称

```http
PUT /api/v2/user-profiles/{qq}
Content-Type: application/json
```

```json
{
  "actorQq": "10001",
  "nickname": "新昵称"
}
```

昵称最多保留 20 个 Unicode 字符，服务端会清理控制字符和多余空白。

> 当前源码中的该处理器只校验 `nickname` 字段，没有调用本人或管理员权限校验。因此对外部署时，不能仅依赖此接口自身保护用户资料；建议在后端补充 `actorQq == path qq` 或管理员 Token 校验。

## 9. 补贴 API

### 9.1 查询补贴预设

```http
GET /api/v2/subsidy-presets
```

响应：

```json
{
  "ok": true,
  "presets": [
    {
      "id": "gold",
      "name": "金币补贴",
      "levels": [
        { "name": "普通", "gold": 1000 }
      ]
    }
  ]
}
```

### 9.2 更新补贴预设

```http
PUT /api/v2/subsidy-presets
Authorization: Bearer <adminToken>
```

```json
{
  "actorQq": "89906502",
  "presets": [
    {
      "id": "gold",
      "name": "金币补贴",
      "levels": [
        { "name": "普通", "gold": 1000 },
        { "name": "高级", "gold": 2000 }
      ]
    }
  ]
}
```

该操作会整体替换补贴预设。

### 9.3 设置团队补贴类型

```http
PUT /api/v2/teams/{teamId}/subsidy-types
Authorization: Bearer <adminToken>
```

```json
{
  "actorQq": "89906502",
  "subsidyTypes": [
    {
      "id": "gold",
      "name": "金币补贴",
      "levels": [
        { "name": "普通", "gold": 1000 }
      ]
    }
  ]
}
```

删除团队中的补贴类型时，服务端会清理引用了不存在类型的成员选择。

### 9.4 登记成员补贴

活动团队：

```http
PUT /api/v2/teams/{teamId}/subsidies/{qq}
```

归档团队：

```http
PUT /api/v2/archives/{archiveId}/subsidies/{qq}
```

```json
{
  "actorQq": "10001",
  "weekStart": "2026-08-03",
  "selections": [
    {
      "typeId": "gold",
      "levelName": "普通",
      "weekStart": "2026-08-03"
    }
  ]
}
```

当传入 `weekStart` 时，只替换该周的选择；不传时替换该 QQ 的全部选择。

## 10. 全量数据和备份 API

### 10.1 全量替换数据

```http
PUT /api/v2/data
Authorization: Bearer <adminToken>
Content-Type: application/json
```

请求体直接传数据对象：

```json
{
  "actorQq": "89906502",
  "teams": [],
  "cancellations": [],
  "archivedTeams": [],
  "logs": [],
  "userProfiles": {},
  "subsidyPresets": []
}
```

该接口会删除并重建团队、槽位、归档、取消记录、操作日志、用户资料和补贴预设。运行时槽位锁、团队锁不会导入，并会被清空。生产环境应优先使用备份恢复，而不是直接调用此接口。

### 10.2 查询备份

```http
GET /api/v2/backups?actorQq=89906502
Authorization: Bearer <adminToken>
```

响应：

```json
{
  "ok": true,
  "backups": [
    {
      "name": "teamassistant-20260806-120000-000.json.gz",
      "createdAt": "2026-08-06T12:00:00.000+08:00",
      "size": 12345
    }
  ]
}
```

服务端每 30 分钟自动创建备份，最多保留 48 个备份。

### 10.3 创建备份

```http
POST /api/v2/backups
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502"
}
```

### 10.4 下载备份

```http
GET /api/v2/backups/{name}/download?actorQq=89906502
Authorization: Bearer <adminToken>
```

返回 `application/gzip` 文件，并通过 `Content-Disposition` 提供文件名。

PowerShell 示例：

```powershell
Invoke-WebRequest `
  -Uri "$Base/backups/$Name/download?actorQq=$AdminQq" `
  -Headers $Headers `
  -OutFile ".\teamassistant-backup.json.gz"
```

### 10.5 恢复备份

```http
POST /api/v2/backups/{name}/restore
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502"
}
```

恢复成功后会返回 `data` 全量快照，并清空运行时锁。

### 10.6 删除备份

```http
DELETE /api/v2/backups/{name}
Authorization: Bearer <adminToken>
Content-Type: application/json
```

```json
{
  "actorQq": "89906502"
}
```

### 10.7 导入备份

导入接口接收原始 JSON 或 `.json.gz` 二进制内容，管理员身份通过查询参数和请求头传入：

```http
POST /api/v2/backups/import?actorQq=89906502
Authorization: Bearer <adminToken>
Content-Type: application/octet-stream
```

PowerShell：

```powershell
Invoke-WebRequest `
  -Method Post `
  -Uri "$Base/backups/import?actorQq=$AdminQq" `
  -Headers $Headers `
  -ContentType "application/octet-stream" `
  -InFile ".\teamassistant-backup.json.gz"
```

支持的备份结构：

```json
{
  "version": 1,
  "createdAt": "2026-08-06T12:00:00.000+08:00",
  "data": {
    "teams": [],
    "cancellations": [],
    "archivedTeams": [],
    "logs": [],
    "userProfiles": {}
  },
  "locks": {
    "slots": [],
    "teams": []
  },
  "subsidyPresets": []
}
```

`locks` 字段仅为兼容旧备份格式，导入后不会恢复运行时锁。

## 11. 错误处理

所有业务错误都应同时检查 HTTP 状态码和 JSON 中的 `ok`：

```json
{
  "ok": false,
  "reason": "slotChanged",
  "currentMemberQq": "10002"
}
```

状态码映射：

| HTTP 状态码 | `reason` 或场景 |
|---|---|
| 200 | 成功，或某些兼容接口返回的业务错误 |
| 400 | 参数缺失、格式错误、`slotRestriction` 等 |
| 403 | `forbidden`、`notOpen`、管理员密码错误 |
| 404 | `notFound`，团队、归档或备份不存在 |
| 409 | `teamLocked`、`expired`、`slotChanged`、`onlyTnSignup`、`uniqueQqSignup`、`selfSignupOnly` |
| 500 | SQLite、文件或其他未预期服务端异常 |
| 501 | 未注册的 `/api/v2/*` 路由 |

建议客户端对以下冲突进行专门处理：

- `expired`：重新获取槽位锁后重试；
- `slotChanged`：重新同步团队数据，不要覆盖当前成员；
- `teamLocked`：等待团队锁释放；
- `slotRestriction`：修改成员武学或选择其他槽位；
- `uniqueQqSignup`：该 QQ 已在团队其他槽位报名；
- `onlyTnSignup`：团队只允许 T/治疗职业；
- `selfSignupOnly`：当前团队禁止代报名。

## 12. 推荐客户端调用流程

普通用户：

1. 调用 `/version` 确认后端可用。
2. 调用 `/bootstrap?qq=...` 获取初始快照。
3. 建立 `/events` SSE 连接。
4. 收到版本事件后调用 `/sync`。
5. 报名时先调用 `/slot-locks`。
6. 携带 `lockToken` 调用成员保存、退出或取消接口。
7. 处理 `409` 冲突并在必要时重新同步。

管理员：

1. 调用 `/admin/check` 判断 QQ 是否为管理员。
2. 调用 `/admin/login` 获取 Token。
3. 后续请求统一使用 `Authorization: Bearer <adminToken>`。
4. 所有写操作在请求体中填写管理员 `actorQq`。
5. 页面关闭或操作结束时调用 `/admin/logout`。

## 13. 当前实现边界

- 当前没有 `GET /api/v2/teams/{teamId}`，团队详情从 `/bootstrap` 或 `/sync` 获取。
- `/teams/{teamId}/lock-state` 修改的是持久化配置字段；真正的进程内存团队锁使用 `/team-locks`。
- 当前槽位锁和团队锁不写入 SQLite，后端重启后全部失效。
- `user-profiles/{qq}` 当前处理器只校验昵称，没有校验 `actorQq` 是否为本人或管理员；对外部署前应补充权限校验。
- 备份恢复、备份导入和 `/data` 全量替换会覆盖大量业务数据，必须在管理员确认和可靠备份后执行。
- 生产环境建议通过 HTTPS 反向代理暴露服务，并限制允许的 CORS 来源，不要直接暴露 SQLite 文件或备份目录。
