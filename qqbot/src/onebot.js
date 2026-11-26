import WebSocket from "ws";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_MIN_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

export class OneBotError extends Error {
  constructor(message, { action = "", retcode = null, data = null } = {}) {
    super(message);
    this.name = "OneBotError";
    this.action = action;
    this.retcode = retcode;
    this.data = data;
  }
}

function normalizeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("OPENQQ_WS_URL 必须使用 ws:// 或 wss://");
  }
  return url;
}

export class OneBotClient {
  constructor({
    url,
    accessToken,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    reconnectMinMs = DEFAULT_RECONNECT_MIN_MS,
    reconnectMaxMs = DEFAULT_RECONNECT_MAX_MS,
    logger = console,
  }) {
    if (typeof accessToken !== "string" || accessToken.length < 16) {
      throw new Error("OPENQQ_ACCESS_TOKEN 必须是至少 16 位非空令牌");
    }
    this.url = normalizeUrl(url);
    this.accessToken = accessToken;
    this.requestTimeoutMs = requestTimeoutMs;
    this.reconnectMinMs = reconnectMinMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.logger = logger;
    this.socket = null;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.nextEcho = 1;
    this.pending = new Map();
    this.onEvent = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    this.stopped = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.connect();
    return this.readyPromise;
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.rejectPending(new OneBotError("OneBot 连接已关闭"));
    this.socket?.terminate();
    this.socket = null;
    this.rejectReady?.(new OneBotError("OneBot 连接已关闭"));
    this.resolveReady = null;
    this.rejectReady = null;
  }

  isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect() {
    if (this.stopped) return;
    const headers = { Authorization: `Bearer ${this.accessToken}` };
    const socket = new WebSocket(this.url, { headers, maxPayload: 48 * 1024 * 1024, handshakeTimeout: 10_000 });
    this.socket = socket;

    socket.once("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.logger.info?.(`[onebot] 已连接 ${this.url.origin}`);
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
    });

    socket.on("message", (data) => this.handleFrame(data));
    socket.on("error", (error) => {
      if (this.socket === socket) this.logger.error?.(`[onebot] 连接错误: ${error.message}`);
    });
    socket.once("close", (code, reason) => {
      if (this.socket === socket) this.socket = null;
      this.rejectPending(new OneBotError(`OneBot 连接关闭 (${code})`));
      if (this.stopped) return;
      const base = Math.min(this.reconnectMaxMs, this.reconnectMinMs * 2 ** this.reconnectAttempt++);
      const delay = Math.round(base * (0.8 + Math.random() * 0.4));
      this.logger.warn?.(`[onebot] ${Math.ceil(delay / 1000)} 秒后重连${reason?.length ? `: ${reason}` : ""}`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  handleFrame(data) {
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      this.logger.warn?.("[onebot] 忽略无法解析的 WebSocket 帧");
      return;
    }
    if (frame && typeof frame === "object" && "echo" in frame && this.pending.has(String(frame.echo))) {
      const pending = this.pending.get(String(frame.echo));
      this.pending.delete(String(frame.echo));
      clearTimeout(pending.timer);
      if (frame.status === "ok" || frame.retcode === 0) {
        pending.resolve(frame.data ?? null);
      } else {
        pending.reject(new OneBotError(frame.message || frame.wording || `OneBot 动作失败 (${frame.retcode})`, {
          action: pending.action,
          retcode: frame.retcode,
          data: frame.data ?? null,
        }));
      }
      return;
    }
    if (frame && typeof frame === "object") this.onEvent?.(frame);
  }

  request(action, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (!this.isOpen()) return Promise.reject(new OneBotError("OneBot 尚未连接", { action }));
    const echo = `teamassistant-${this.nextEcho++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new OneBotError(`OneBot 动作超时: ${action}`, { action }));
      }, timeoutMs);
      this.pending.set(echo, { action, resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ action, params, echo }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(new OneBotError(`OneBot 发送失败: ${action}`, { action, data: error }));
      }
    });
  }

  async getGroupMembers(groupId) {
    const data = await this.request("get_group_member_list", { group_id: groupId });
    if (!Array.isArray(data)) throw new OneBotError("get_group_member_list 返回格式无效", { action: "get_group_member_list" });
    return data;
  }

  async sendText(target) {
    if (target.kind === "group") {
      return this.request("send_group_msg", {
        group_id: target.groupId,
        message: target.text,
        auto_escape: true,
      });
    }
    return this.request("send_private_msg", {
      user_id: target.userId,
      message: target.text,
      auto_escape: true,
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function messageToText(message) {
  if (typeof message === "string") return message.replace(/\[CQ:at,[^\]]+\]/gi, "").trim();
  if (!Array.isArray(message)) return "";
  return message
    .map((segment) => {
      if (segment?.type === "text") return String(segment.data?.text ?? "");
      if (segment?.type === "at") return "";
      return "";
    })
    .join("")
    .trim();
}

export function normalizeGroupMember(member) {
  const qq = String(member?.user_id ?? "").trim();
  if (!/^\d{5,20}$/.test(qq)) return null;
  const joinTime = Number(member?.join_time);
  return {
    qq,
    nickname: String(member?.nickname ?? "").trim().slice(0, 128),
    card: String(member?.card ?? "").trim().slice(0, 128),
    role: ["owner", "admin", "member"].includes(member?.role) ? member.role : "member",
    joinTimeMs: Number.isSafeInteger(joinTime) && joinTime > 0 ? joinTime * 1000 : 0,
  };
}
