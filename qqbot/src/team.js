/**
 * TeamAssistant 后端 API 客户端
 *
 * 对接 https://docs/api-v2.md 描述的 HTTP API（Drogon + SQLite）。
 * 报名/退出遵循「获取槽位锁 → 写入 → 释放锁」流程，失败时也会释放锁。
 */
import { config } from "./config.js";

/** 后端业务错误：携带 HTTP 状态码与 reason */
export class TeamApiError extends Error {
  constructor(reason, status, data = {}) {
    super(reason);
    this.name = "TeamApiError";
    this.reason = reason;
    this.status = status;
    this.data = data;
  }
}

/** reason → 中文提示 */
const REASON_TEXT = {
  forbidden: "没有权限执行该操作",
  notOpen: "报名通道未开放",
  notFound: "团队或槽位不存在",
  slotChanged: "槽位已被他人修改，请重新查看后操作",
  expired: "操作超时，请重试",
  teamLocked: "团队当前被锁定，请稍后再试",
  slotRestriction: "该槽位限制了角色或武学，请更换武学或选择其他槽位",
  uniqueQqSignup: "你已经在其他槽位报名了",
  onlyTnSignup: "该团队只允许 T/治疗职业报名",
  selfSignupOnly: "该团队禁止代报名",
  invalidMember: "报名信息不合法",
  lockedBy: "该槽位刚刚被别人占用了，请重新查看后选择其他槽位",
  invalidPassword: "密码错误，请重新输入",
  adminPasswordMissing: "后端未配置管理员密码，请先在后端设置",
  timeout: "后端服务响应超时，请稍后再试",
  invalidResponse: "后端服务返回了无效数据，请稍后再试",
};

/** 把后端错误对象转成中文提示文本 */
export function describeError(err) {
  if (err instanceof TeamApiError) {
    return REASON_TEXT[err.reason] ?? `操作失败（${err.reason}）`;
  }
  if (err instanceof TypeError) {
    return "后端服务不可用，请稍后再试";
  }
  return `操作失败：${err.message ?? err}`;
}

/** 团队成员对象 */
function buildMember(qq, { martialArtIndex = "", gearScore = "", characterId = "", note = "" } = {}) {
  const member = { qq, martialArtIndex: String(martialArtIndex), gearScore: String(gearScore), characterId, note };
  return member;
}

/**
 * TeamAssistant API 客户端。
 * @param {object} opts - { baseUrl, inviteToken, timeoutMs }，超时默认 10 秒，包含读取响应体。
 */
export function createTeamClient({ baseUrl = config.teamBaseUrl, inviteToken = config.teamInviteToken, timeoutMs = 10_000 } = {}) {
  const apiBase = baseUrl.replace(/\/+$/, "");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError("timeoutMs must be a positive finite duration");
  }

  /**
   * 发起 JSON 请求，在保留已有查询参数的基础上追加 inviteToken。
   * 非 2xx 或 ok:false 时抛 TeamApiError。
   */
  async function request(method, path, body) {
    const url = new URL(`${apiBase}${path}`);
    if (inviteToken) url.searchParams.set("inviteToken", inviteToken);
    const signal = AbortSignal.timeout(Math.ceil(timeoutMs));
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      let json;
      try {
        json = await res.json();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new TeamApiError(res.ok ? "invalidResponse" : `HTTP ${res.status}`, res.status);
      }
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        throw new TeamApiError("invalidResponse", res.status);
      }
      if (!res.ok || json.ok === false) {
        const reason = json.reason || (typeof json.lockedBy === "string" ? "lockedBy" : `HTTP ${res.status}`);
        throw new TeamApiError(reason, res.status, json);
      }
      return json;
    } catch (error) {
      if (error instanceof TeamApiError) throw error;
      if (signal.aborted) throw new TeamApiError("timeout", 0);
      throw new TypeError("backend unreachable", { cause: error });
    }
  }

  /** 拉取初始快照（teams / slots / userProfiles 等） */
  async function bootstrap(qq) {
    return request("GET", `/bootstrap?qq=${encodeURIComponent(qq)}`);
  }

  /** 判断 QQ 号是否管理员（GET /admin/check，无需鉴权） */
  async function checkAdmin(qq) {
    const json = await request("GET", `/admin/check?actorQq=${encodeURIComponent(qq)}`);
    return json.isAdmin === true;
  }

  /** 管理员密码登录（POST /admin/login），失败抛 TeamApiError */
  async function adminLogin(qq, password) {
    const json = await request("POST", "/admin/login", { actorQq: qq, password });
    return json.adminToken;
  }

  /** 获取槽位锁，返回 lockToken；被占用时抛 TeamApiError(lockedBy) */
  async function acquireSlotLock(qq, teamId, slotIndex) {
    const json = await request("POST", "/slot-locks", { teamId, slotIndex, qq, inviteToken });
    if (!json.lockToken) {
      throw new TeamApiError("lockedBy", 409, json);
    }
    return json.lockToken;
  }

  /** 释放槽位锁（幂等，失败不抛错） */
  async function releaseSlotLock(qq, teamId, slotIndex, lockToken) {
    try {
      await request("DELETE", `/slot-locks/${encodeURIComponent(teamId)}/${slotIndex}`, {
        qq,
        lockToken,
        inviteToken,
      });
    } catch {
      // 释放锁是最佳努力操作，忽略失败
    }
  }

  /**
   * 报名：获取锁 → 保存成员 → 释放锁。
   * @param {string} qq 成员 QQ
   * @param {string} teamId 团队 id
   * @param {number} slotIndex 槽位下标
   * @param {object} fields - { martialArtIndex, gearScore, characterId, note }
   */
  async function signup(qq, teamId, slotIndex, fields = {}) {
    const member = buildMember(qq, fields);
    const lockToken = await acquireSlotLock(qq, teamId, slotIndex);
    try {
      await request("PUT", `/teams/${encodeURIComponent(teamId)}/slots/${slotIndex}/member`, {
        qq,
        actorQq: qq,
        lockToken,
        expectedMemberQq: null, // 空槽位报名
        member,
        inviteToken,
      });
    } finally {
      await releaseSlotLock(qq, teamId, slotIndex, lockToken);
    }
  }

  /**
   * 退出报名：获取锁 → 清空槽位 → 释放锁。
   * expectedMemberQq 传当前成员 QQ，防止覆盖他人修改。
   */
  async function withdraw(qq, teamId, slotIndex, expectedMemberQq) {
    const lockToken = await acquireSlotLock(qq, teamId, slotIndex);
    try {
      await request("DELETE", `/teams/${encodeURIComponent(teamId)}/slots/${slotIndex}/member`, {
        qq,
        actorQq: qq,
        lockToken,
        expectedMemberQq,
        inviteToken,
      });
    } finally {
      await releaseSlotLock(qq, teamId, slotIndex, lockToken);
    }
  }

  return { bootstrap, signup, withdraw, request, checkAdmin, adminLogin };
}
