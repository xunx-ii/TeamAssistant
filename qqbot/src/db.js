/**
 * SQLite 存储模块（Node 24 内置 node:sqlite，零依赖）
 *
 * 持久化 QQ 对话与消息历史，作为机器人重启后的记忆来源。
 * 表结构：
 *   conversations - 对话（私聊用户 / 群）
 *   messages     - 消息（user / assistant）
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DB_PATH = join(ROOT, "data", "qqbot.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,            -- c2c:<openid> 或 group:<group_openid>
    kind       TEXT NOT NULL,               -- 'c2c' | 'group'
    peer_id    TEXT NOT NULL,               -- 用户 openid 或群 group_openid
    title      TEXT,                        -- 群名称等
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role            TEXT NOT NULL,          -- 'user' | 'assistant'
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

  CREATE TABLE IF NOT EXISTS bindings (
    openid     TEXT PRIMARY KEY,            -- QQ 机器人 openid
    qq         TEXT NOT NULL UNIQUE,        -- 真实 QQ 号（一个号只能被一个 openid 绑定，防冒充）
    player_id  TEXT NOT NULL DEFAULT '',    -- 昵称（绑定指令中用户输入，或从后端同步）
    created_at INTEGER NOT NULL
  );
`);

// 旧库迁移：为已存在的 bindings 表补充 player_id 列
const bindingCols = db.prepare(`PRAGMA table_info(bindings)`).all().map((c) => c.name);
if (!bindingCols.includes("player_id")) {
  db.exec(`ALTER TABLE bindings ADD COLUMN player_id TEXT NOT NULL DEFAULT ''`);
}

/** 获取或创建对话记录，返回 { id, kind, peerId } */
export function getOrCreateConversation({ kind, peerId, title = null }) {
  const id = `${kind}:${peerId}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO conversations (id, kind, peer_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  ).run(id, kind, peerId, title, now, now);

  return { id, kind, peerId };
}

/** 追加一条消息 */
export function appendMessage(conversationId, role, content) {
  db.prepare(
    `INSERT INTO messages (conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(conversationId, role, content, Date.now());
}

/** 取最近 N 条消息（按时间正序返回，用于注入 pi 会话恢复记忆） */
export function getRecentMessages(conversationId, limit = 20) {
  return db
    .prepare(
      `SELECT role, content, created_at FROM messages
       WHERE conversation_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(conversationId, limit)
    .reverse();
}

/** 列出全部对话（启动时用于恢复各对话的 pi 会话） */
export function listConversations() {
  return db.prepare(`SELECT id, kind, peer_id, title FROM conversations ORDER BY updated_at DESC`).all();
}

/** 查询 openid 的绑定信息，未绑定返回 null */
export function getBinding(openid) {
  return db.prepare(`SELECT qq, player_id FROM bindings WHERE openid = ?`).get(openid) ?? null;
}

/**
 * 绑定或更新 openid → {qq, 昵称}。
 * 同一 openid 重复绑定会更新（换绑 ID/QQ）；不同 openid 绑定同一 QQ 号会被拒绝。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function setBinding(openid, qq, playerId = "") {
  try {
    db.prepare(
      `INSERT INTO bindings (openid, qq, player_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(openid) DO UPDATE SET qq = excluded.qq, player_id = excluded.player_id`,
    ).run(openid, qq, playerId, Date.now());
    return { ok: true };
  } catch {
    return { ok: false, reason: "该 QQ 号已被其他账号绑定" };
  }
}

/** 解除 openid 的绑定 */
export function deleteBinding(openid) {
  db.prepare(`DELETE FROM bindings WHERE openid = ?`).run(openid);
}
