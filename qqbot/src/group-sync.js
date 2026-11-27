import { normalizeGroupMember } from "./onebot.js";

function memberLabel(member) {
  return member?.card || member?.nickname || member?.qq || "未知成员";
}

export function createGroupMembershipSync({
  oneBot,
  teamClient,
  groupId,
  intervalMs,
  notify,
  logger = console,
}) {
  let members = new Map();
  let syncPromise = null;
  let interval = null;
  let debounceTimer = null;
  let stopped = false;

  async function safeNotify(message) {
    try {
      await notify(message);
    } catch (error) {
      logger.error?.(`[membership] 群通知发送失败: ${error.message ?? error}`);
    }
  }

  async function refresh() {
    if (syncPromise) return syncPromise;
    if (!oneBot.isOpen()) return null;
    syncPromise = (async () => {
      const rawMembers = await oneBot.getGroupMembers(groupId);
      const normalized = rawMembers.map(normalizeGroupMember).filter(Boolean);
      const result = await teamClient.syncGroupMembers(groupId, normalized);
      members = new Map(normalized.map(member => [member.qq, member]));
      logger.info?.(`[membership] 群 ${groupId} 白名单已同步，共 ${members.size} 人`);

      const added = Array.isArray(result.added) ? result.added : [];
      const removed = Array.isArray(result.removed) ? result.removed : [];
      if (result.initialized === true && members.size > 0) {
        await safeNotify(`报名系统白名单已初始化，共 ${members.size} 人。群成员可直接使用 QQ 号登录。`);
      } else {
        for (const member of added) {
          await safeNotify(`新成员 ${memberLabel(member)} 已自动加入报名系统白名单，可直接使用 QQ 号登录。`);
        }
        if (removed.length > 0) {
          logger.info?.(`[membership] 已回收 ${removed.length} 名退群成员的报名权限`);
        }
      }
      return result;
    })().catch((error) => {
      logger.error?.(`[membership] 群成员同步失败: ${error.message ?? error}`);
      return null;
    }).finally(() => {
      syncPromise = null;
    });
    return syncPromise;
  }

  async function hasMember(qq) {
    const normalized = String(qq ?? "").trim();
    if (members.has(normalized)) return true;
    await refresh();
    return members.has(normalized);
  }

  function scheduleRefresh(delayMs = 700) {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void refresh();
    }, delayMs);
    debounceTimer.unref?.();
  }

  function handleEvent(event) {
    if (event?.post_type !== "notice") return;
    if (String(event.group_id ?? "") !== String(groupId)) return;
    if (["group_increase", "group_decrease", "group_card", "group_admin"].includes(event.notice_type)) {
      scheduleRefresh();
    }
  }

  async function start() {
    stopped = false;
    await refresh();
    interval = setInterval(() => void refresh(), intervalMs);
    interval.unref?.();
  }

  function stop() {
    stopped = true;
    if (interval) clearInterval(interval);
    if (debounceTimer) clearTimeout(debounceTimer);
    interval = null;
    debounceTimer = null;
  }

  return {
    start,
    stop,
    refresh,
    hasMember,
    handleEvent,
    getMember(qq) {
      return members.get(String(qq ?? "").trim()) ?? null;
    },
    get size() {
      return members.size;
    },
  };
}
