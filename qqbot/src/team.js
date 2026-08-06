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
 * @param {object} opts - { baseUrl, inviteToken }
 */
export function createTeamClient({ baseUrl = config.teamBaseUrl, inviteToken = config.teamInviteToken } = {}) {
  const apiBase = baseUrl.replace(/\/+$/, "");

  /**
   * 发起 JSON 请求；inviteToken 同时放在请求体和查询参数（后端 body 优先）。
   * 非 2xx 或 ok:false 时抛 TeamApiError。
   */
  async function request(method, path, body) {
    const query = inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : "";
    let res;
    try {
      res = await fetch(`${apiBase}${path}${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new TypeError("backend unreachable");
    }

    let json = null;
    try {
      json = await res.json();
    } catch {
      // 非 JSON 响应
    }

    if (!res.ok || (json && json.ok === false)) {
      const reason = json?.reason || `HTTP ${res.status}`;
      throw new TeamApiError(reason, res.status, json ?? {});
    }
    return json;
  }

  /** 拉取初始快照（teams / slots / userProfiles 等） */
  async function bootstrap(qq) {
    const query = inviteToken ? `&inviteToken=${encodeURIComponent(inviteToken)}` : "";
    let res;
    try {
      res = await fetch(`${apiBase}/bootstrap?qq=${encodeURIComponent(qq)}${query}`);
    } catch {
      throw new TypeError("backend unreachable");
    }
    const json = await res.json();
    if (!res.ok || json?.ok === false) {
      throw new TeamApiError(json?.reason || `HTTP ${res.status}`, res.status, json ?? {});
    }
    return json;
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
    let json;
    try {
      json = await request("POST", "/slot-locks", { teamId, slotIndex, qq, inviteToken });
    } catch (err) {
      // 后端锁冲突响应（{ok:false, lockedBy}）不带 reason，统一翻译为 lockedBy
      if (err instanceof TeamApiError && err.status === 409 && !err.reason?.startsWith?.("HTTP")) {
        throw new TeamApiError("lockedBy", 409, err.data);
      }
      throw err;
    }
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
