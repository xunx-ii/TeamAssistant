/**
 * 团队报名指令模块。
 *
 * 群聊中 @ 机器人后直接发送指令，不带 / 前缀。所有指令返回
 * { handled, reply }，未命中的普通聊天继续交给 AI。
 */
import { config } from "./config.js";
import { findMartialArt } from "./martial-arts.js";
import { createDefaultTeam, createTeamClient, describeError } from "./team.js";

const MAX_TEAM_NAME_LENGTH = 40;
const MAX_CHARACTER_LENGTH = 40;
const MAX_GEAR_SCORE_LENGTH = 8;
const MAX_CANCEL_REASON_LENGTH = 200;
const TOTAL_SLOTS = 25;

const ROLE_EMOJI = { T: "🛡", 治疗: "💗", DPS: "⚔", boss: "💰" };
const RESERVE_TYPES = {
  T: { value: "T", label: "T" },
  t: { value: "T", label: "T" },
  治疗: { value: "治疗", label: "治疗" },
  奶: { value: "治疗", label: "治疗" },
  DPS: { value: "DPS", label: "DPS" },
  dps: { value: "DPS", label: "DPS" },
  老板: { value: "boss", label: "老板" },
  boss: { value: "boss", label: "老板" },
};
const TEAM_RULES = {
  仅T奶: { patch: { onlyTnSignup: true }, reply: "已设置为仅允许 T/治疗报名" },
  取消仅T奶: { patch: { onlyTnSignup: false }, reply: "已允许全职业报名" },
  唯一QQ: { patch: { uniqueQqSignup: true }, reply: "已设置为每个 QQ 只能报名一个槽位" },
  取消唯一QQ: { patch: { uniqueQqSignup: false }, reply: "已允许同一 QQ 报名多个槽位" },
};

const HELP_TEXT = `📖 TeamAssistant 指令

群员指令
报名 <团队> <角色名> <武学> [装分] [#槽位]
取消 <团队> [原因]
退出 <团队> [原因]
我的报名 [团队]
团队 [名称]
帮助

管理员指令
开团 <名称> [周YYYY-MM-DD]
改名 <团队> <新名称>
删团 <团队>
锁定 <团队>
解锁 <团队>
代取消 <团队> <QQ> [原因]
快速预留 <团队> <T|治疗|DPS|老板> [数量] [武学]
设置规则 <团队> <仅T奶|取消仅T奶|唯一QQ|取消唯一QQ>

群聊中请先 @机器人。团队名含空格时可用英文引号包裹。`;

/** 剥离旧 SDK 或字符串消息中残留的提及标签。 */
export function stripMentions(text) {
  return String(text ?? "")
    .replace(/<@!?[^>]+>/g, "")
    .replace(/\[CQ:at,[^\]]+\]/gi, "")
    .trim();
}

/** 支持引号的轻量参数分割，便于团队名和角色名包含空格。 */
function splitCommandArgs(text) {
  const args = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value) args.push(value);
  }
  return args;
}

function normalizeSingleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textLength(value) {
  return Array.from(value).length;
}

function boundedText(value, maxLength) {
  const normalized = normalizeSingleLine(value);
  if (!normalized) return { value: "", error: "内容不能为空" };
  if (textLength(normalized) > maxLength) return { value: "", error: `内容不能超过 ${maxLength} 个字符` };
  return { value: normalized };
}

function formatWeekStart(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function currentWeekStart() {
  const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const offset = shanghaiNow.getUTCDay() === 0 ? -6 : 1 - shanghaiNow.getUTCDay();
  shanghaiNow.setUTCDate(shanghaiNow.getUTCDate() + offset);
  return formatWeekStart(shanghaiNow);
}

/** 将周内任意日期归一化到该周周一。 */
function normalizeWeekStart(value) {
  const raw = String(value ?? "").replace(/^周/, "");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  const offset = date.getUTCDay() === 0 ? -6 : 1 - date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + offset);
  return formatWeekStart(date);
}

/**
 * 创建指令处理器。
 * @param {object} options
 * @param {(qq: string) => Promise<boolean>} options.isGroupMember 实时群成员校验
 * @returns {{ handle(message: {senderId: string, text: string, kind?: string}): Promise<{handled: boolean, reply?: string}> }}
 */
export function createCommandHandler({ isGroupMember } = {}) {
  const team = createTeamClient();
  const lastCommandAt = new Map();
  const throttleMs = config.userRateLimitSec * 1000;

  function checkThrottle(senderId) {
    if (throttleMs <= 0) return null;
    const now = Date.now();
    const last = lastCommandAt.get(senderId) ?? 0;
    if (now - last < throttleMs) {
      const wait = Math.max(1, Math.ceil((throttleMs - (now - last)) / 1000));
      return `⏳ 操作太频繁了，请 ${wait} 秒后再试～`;
    }
    lastCommandAt.set(senderId, now);
    return null;
  }

  async function requireMembership(senderId) {
    if (typeof senderId !== "string" || !/^\d{5,20}$/.test(senderId)) {
      return { error: "无法识别你的 QQ 号，请通过 OpenQQ 通道使用指令" };
    }
    if (isGroupMember && !(await isGroupMember(senderId))) {
      return { error: `请先加入 QQ 群 ${config.qqGroupId} 后再使用报名机器人` };
    }
    return { qq: senderId };
  }

  async function requireAdmin(senderId) {
    const membership = await requireMembership(senderId);
    if (membership.error) return membership;
    try {
      const check = await team.checkAdmin(membership.qq);
      if (!check.isAdmin) return { error: "❌ 该指令仅限 TeamAssistant 管理员使用" };
    } catch (err) {
      return { error: `❌ 管理员校验失败：${describeError(err)}` };
    }
    return membership;
  }

  async function loadSnapshot(qq) {
    try {
      return { snapshot: await team.bootstrap(qq) };
    } catch (err) {
      return { error: `❌ ${describeError(err)}` };
    }
  }

  /** 按名称查找团队：精确 → 前缀 → 包含。 */
  function findTeam(teams, name) {
    if (!name) return null;
    const exact = teams.find((item) => item.name === name);
    if (exact) return exact;
    const prefix = teams.filter((item) => item.name.startsWith(name));
    if (prefix.length === 1) return prefix[0];
    const includes = teams.filter((item) => item.name.includes(name));
    if (includes.length === 1) return includes[0];
    if (includes.length > 1) return { ambiguous: true, names: includes.map((item) => item.name) };
    return null;
  }

  function resolveTeam(teams, input) {
    const target = findTeam(teams, input);
    if (!target) return { error: `❌ 未找到团队「${input}」，可发送 团队 查看列表` };
    if (target.ambiguous) return { error: `❌ 团队名称有歧义：${target.names.join("、")}，请写完整名称` };
    return { team: target };
  }

  function parseSignupArgs(tokens) {
    const parsed = {};
    for (const token of tokens) {
      if (!token) continue;
      const slotMatch = token.match(/^#(\d+)$/);
      if (slotMatch) {
        const index = Number(slotMatch[1]);
        if (index >= 0 && index < TOTAL_SLOTS) parsed.slotIndex = index;
        continue;
      }
      if (/^\d+$/.test(token)) {
        if (parsed.gearScore === undefined) parsed.gearScore = token;
        continue;
      }
      const martialArt = findMartialArt(token);
      if (martialArt && parsed.martialArtIndex === undefined) {
        parsed.martialArt = martialArt;
        parsed.martialArtIndex = martialArt.index;
        continue;
      }
      parsed.characterId = [parsed.characterId, token].filter(Boolean).join(" ");
    }
    return parsed;
  }

  function slotLine(slot) {
    if (slot.status === "empty") return null;
    const index = `[${slot.index}]`;
    if (slot.status === "reserved") return `${index} 🔒预留`;
    if (slot.status === "fixed") {
      const martialArt = slot.fixedMartialArtIndex != null ? findMartialArt(String(slot.fixedMartialArtIndex)) : null;
      return `${index} 固定(${slot.fixedRole ?? ""}${martialArt ? "·" + martialArt.label : ""})`;
    }
    const member = slot.member ?? {};
    const martialArt = findMartialArt(String(member.martialArtIndex ?? ""));
    const parts = [member.characterId || member.qq || "?"];
    if (martialArt) parts.push(martialArt.label);
    if (member.gearScore) parts.push(member.gearScore);
    return `${index} ${parts.join(" · ")}`;
  }

  function registrationLine(target, slot) {
    const member = slot.member ?? {};
    const martialArt = findMartialArt(String(member.martialArtIndex ?? ""));
    const parts = [`${target.name} [${slot.index}]`, member.characterId || member.qq || "?"];
    if (martialArt) parts.push(martialArt.label);
    if (member.gearScore) parts.push(`装分 ${member.gearScore}`);
    return `· ${parts.join(" · ")}`;
  }

  async function cmdSignup(senderId, args) {
    const membership = await requireMembership(senderId);
    if (membership.error) return membership.error;
    const qq = membership.qq;

    const [teamName, ...rest] = args;
    if (!teamName || !rest.length) {
      return "❌ 格式：报名 <团队> <角色名> <武学> [装分] [#槽位]";
    }
    const parsed = parseSignupArgs(rest);
    const character = boundedText(parsed.characterId, MAX_CHARACTER_LENGTH);
    if (character.error) return `❌ 角色名无效：${character.error}`;
    if (!parsed.martialArt) return "❌ 缺少武学（心法），请填写完整武学名或心法名";
    if (parsed.gearScore && parsed.gearScore.length > MAX_GEAR_SCORE_LENGTH) {
      return `❌ 装分不能超过 ${MAX_GEAR_SCORE_LENGTH} 位数字`;
    }

    const loaded = await loadSnapshot(qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    const target = resolved.team;

    const existingSlot = (target.slots ?? []).find((slot) => slot.member && String(slot.member.qq) === qq);
    if (existingSlot) {
      return `⚠️ 你已在 ${target.name} 的 [${existingSlot.index}] 槽位报名，如需换位请先发送 取消 ${target.name}`;
    }

    let slot;
    if (parsed.slotIndex !== undefined) {
      slot = (target.slots ?? []).find((item) => item.index === parsed.slotIndex) ?? null;
      if (!slot) return `❌ 团队 ${target.name} 没有 [${parsed.slotIndex}] 号槽位`;
      if (slot.status !== "empty") return `❌ [${parsed.slotIndex}] 号槽位已被占用`;
    } else {
      slot = (target.slots ?? []).find((item) => item.status === "empty") ?? null;
      if (!slot) return `❌ 团队 ${target.name} 没有空槽位了`;
    }

    try {
      await team.signup(qq, target.id, slot.index, {
        characterId: character.value,
        martialArtIndex: parsed.martialArt.index,
        gearScore: parsed.gearScore ?? "",
      });
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }

    const parts = [`✅ 报名成功：${target.name} [${slot.index}]`, character.value, parsed.martialArt.label];
    if (parsed.gearScore) parts.push(`装分 ${parsed.gearScore}`);
    return parts.join("\n");
  }

  async function cmdCancel(senderId, args) {
    const membership = await requireMembership(senderId);
    if (membership.error) return membership.error;
    const qq = membership.qq;

    const [teamName, ...reasonParts] = args;
    if (!teamName) return "❌ 格式：取消 <团队> [原因]";
    const reason = normalizeSingleLine(reasonParts.join(" "));
    if (textLength(reason) > MAX_CANCEL_REASON_LENGTH) {
      return `❌ 取消原因不能超过 ${MAX_CANCEL_REASON_LENGTH} 个字符`;
    }

    const loaded = await loadSnapshot(qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    const target = resolved.team;
    const mySlot = (target.slots ?? []).find((slot) => slot.member && String(slot.member.qq) === qq);
    if (!mySlot) return `⚠️ 你在 ${target.name} 没有报名`;

    try {
      await team.cancelSlot(qq, target.id, mySlot.index, qq, reason);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ 已取消 ${target.name} 的 [${mySlot.index}] 报名${reason ? `\n原因：${reason}` : ""}`;
  }

  async function cmdMySignups(senderId, args) {
    const membership = await requireMembership(senderId);
    if (membership.error) return membership.error;
    const qq = membership.qq;
    const loaded = await loadSnapshot(qq);
    if (loaded.error) return loaded.error;

    const requestedTeam = normalizeSingleLine(args.join(" "));
    let teams = loaded.snapshot.teams ?? [];
    if (requestedTeam) {
      const resolved = resolveTeam(teams, requestedTeam);
      if (resolved.error) return resolved.error;
      teams = [resolved.team];
    }

    const lines = [];
    for (const target of teams) {
      for (const slot of target.slots ?? []) {
        if (slot.member && String(slot.member.qq) === qq) lines.push(registrationLine(target, slot));
      }
    }
    return lines.length ? `📋 我的报名\n${lines.join("\n")}` : "📋 当前没有报名记录";
  }

  async function cmdTeams(senderId, args) {
    const membership = await requireMembership(senderId);
    if (membership.error) return membership.error;
    const qq = membership.qq;

    const loaded = await loadSnapshot(qq);
    if (loaded.error) return loaded.error;
    const teams = loaded.snapshot.teams ?? [];
    if (!teams.length) return "📋 当前没有团队";

    const name = normalizeSingleLine(args.join(" "));
    if (!name) {
      const lines = teams.map((item) => {
        const slots = item.slots ?? [];
        const occupied = slots.filter((slot) => slot.status === "occupied").length;
        const reserved = slots.filter((slot) => slot.status === "reserved").length;
        return `· ${item.name}　${occupied}/${slots.length} 已报名${reserved ? `，${reserved} 预留` : ""}`;
      });
      return `📋 团队列表（${teams.length} 个）\n${lines.join("\n")}\n\n发送 团队 <名称> 查看详情`;
    }

    const resolved = resolveTeam(teams, name);
    if (resolved.error) return resolved.error;
    const target = resolved.team;
    const slots = target.slots ?? [];

    if (config.qqMarkdown) {
      const cell = (slot) => {
        if (!slot || slot.status === "empty") return "-";
        if (slot.status === "reserved") return "预留";
        if (slot.status === "fixed") {
          const martialArt = findMartialArt(String(slot.fixedMartialArtIndex ?? ""));
          if (martialArt) return `预留\\|${ROLE_EMOJI[martialArt.role] ?? ""}${martialArt.name}`;
          const role = slot.fixedRole || "";
          if (role) return `预留\\|${ROLE_EMOJI[role] ?? ""}${role === "boss" ? "老板" : role}`;
          return "预留";
        }
        const member = slot.member ?? {};
        const martialArt = findMartialArt(String(member.martialArtIndex ?? ""));
        return `${martialArt ? ROLE_EMOJI[martialArt.role] ?? "" : ""}${martialArt?.name ?? "?"}\\|${member.characterId || member.qq || "?"}`;
      };
      const grid = Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 5 }, (_, column) => cell(slots[column * 5 + row])),
      );
      const table =
        `| 槽位 0-4 | 槽位 5-9 | 槽位 10-14 | 槽位 15-19 | 槽位 20-24 |\n` +
        `| --- | --- | --- | --- | --- |\n` +
        grid.map((row) => `| ${row.join(" | ")} |`).join("\n");
      return `### ${target.name}${target.weekStart ? `（周 ${target.weekStart}）` : ""}\n\n${table}\n\n空位 ${slots.filter((slot) => slot.status === "empty").length} 个`;
    }

    const lines = slots.map(slotLine).filter(Boolean);
    const header = `📋 ${target.name}${target.weekStart ? `（周 ${target.weekStart}）` : ""}`;
    return `${header}\n${lines.length ? lines.join("\n") : "（暂无报名）"}\n空位 ${slots.filter((slot) => slot.status === "empty").length} 个`;
  }

  async function cmdCreateTeam(senderId, args) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    if (!args.length) return "❌ 格式：开团 <名称> [周YYYY-MM-DD]";

    const nameParts = [...args];
    let weekStart = currentWeekStart();
    const last = nameParts.at(-1) ?? "";
    if (/^周?\d{4}-\d{2}-\d{2}$/.test(last)) {
      nameParts.pop();
      weekStart = normalizeWeekStart(last);
      if (!weekStart) return "❌ 日期无效，请使用 YYYY-MM-DD，例如 周2026-11-23";
    }
    const name = boundedText(nameParts.join(" "), MAX_TEAM_NAME_LENGTH);
    if (name.error) return `❌ 团队名无效：${name.error}`;

    try {
      await team.createTeam(admin.qq, createDefaultTeam(name.value, { weekStart }));
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ 已开团：${name.value}\n周：${weekStart}\n发送 团队 ${name.value} 查看详情`;
  }

  async function cmdRenameTeam(senderId, args) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    const [teamName, ...nameParts] = args;
    if (!teamName || !nameParts.length) return "❌ 格式：改名 <团队> <新名称>";
    const newName = boundedText(nameParts.join(" "), MAX_TEAM_NAME_LENGTH);
    if (newName.error) return `❌ 新团队名无效：${newName.error}`;

    const loaded = await loadSnapshot(admin.qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    try {
      await team.updateTeam(admin.qq, resolved.team.id, { name: newName.value });
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ 已将 ${resolved.team.name} 改名为 ${newName.value}`;
  }

  async function cmdDeleteTeam(senderId, args) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    const teamName = normalizeSingleLine(args.join(" "));
    if (!teamName) return "❌ 格式：删团 <团队>";

    const loaded = await loadSnapshot(admin.qq);
    if (loaded.error) return loaded.error;
    const teams = loaded.snapshot.teams ?? [];
    const resolved = resolveTeam(teams, teamName);
    if (resolved.error) return resolved.error;
    const fallback = teams.length === 1 ? createDefaultTeam("默认团队", { weekStart: currentWeekStart() }) : undefined;
    try {
      await team.deleteTeam(admin.qq, resolved.team.id, fallback);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ 已删除团队：${resolved.team.name}${fallback ? "\n已创建“默认团队”供后续使用" : ""}`;
  }

  async function cmdSetTeamLock(senderId, args, locked) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    const teamName = normalizeSingleLine(args.join(" "));
    if (!teamName) return `❌ 格式：${locked ? "锁定" : "解锁"} <团队>`;

    const loaded = await loadSnapshot(admin.qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    try {
      if (locked) await team.lockTeam(admin.qq, resolved.team.id);
      else await team.unlockTeam(admin.qq, resolved.team.id);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return locked ? `🔒 已暂停 ${resolved.team.name} 的报名` : `🔓 已恢复 ${resolved.team.name} 的报名`;
  }

  async function cmdAdminCancel(senderId, args) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    const [teamName, targetQq, ...reasonParts] = args;
    if (!teamName || !targetQq) return "❌ 格式：代取消 <团队> <QQ> [原因]";
    if (!/^\d{5,20}$/.test(targetQq)) return "❌ 目标 QQ 格式不正确";
    const reason = normalizeSingleLine(reasonParts.join(" "));
    if (textLength(reason) > MAX_CANCEL_REASON_LENGTH) {
      return `❌ 取消原因不能超过 ${MAX_CANCEL_REASON_LENGTH} 个字符`;
    }

    const loaded = await loadSnapshot(admin.qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    const target = resolved.team;
    const targetSlot = (target.slots ?? []).find((slot) => slot.member && String(slot.member.qq) === targetQq);
    if (!targetSlot) return `⚠️ ${targetQq} 在 ${target.name} 没有报名`;

    try {
      await team.cancelSlot(admin.qq, target.id, targetSlot.index, targetQq, reason);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ 已代 ${targetQq} 取消 ${target.name} 的 [${targetSlot.index}] 报名${reason ? `\n原因：${reason}` : ""}`;
  }

  async function cmdQuickReserve(senderId, args) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    const [teamName, roleToken, ...optionTokens] = args;
    if (!teamName || !roleToken) {
      return "❌ 格式：快速预留 <团队> <T|治疗|DPS|老板> [数量] [武学]";
    }
    const reserveType = RESERVE_TYPES[roleToken];
    if (!reserveType) return "❌ 预留职业仅支持 T、治疗、DPS、老板";

    let count = 1;
    let countSpecified = false;
    let martialArt = null;
    for (const token of optionTokens) {
      if (/^\d+$/.test(token) && !countSpecified) {
        count = Number(token);
        countSpecified = true;
        continue;
      }
      const parsedMartialArt = findMartialArt(token);
      if (parsedMartialArt && !martialArt) {
        martialArt = parsedMartialArt;
        continue;
      }
      return `❌ 无法识别预留参数：${token}`;
    }
    if (!Number.isInteger(count) || count < 0 || count > TOTAL_SLOTS) {
      return `❌ 预留数量必须是 0-${TOTAL_SLOTS} 的整数`;
    }
    if (reserveType.value === "DPS" && !martialArt) return "❌ DPS 预留必须指定具体 DPS 武学";
    if (reserveType.value === "DPS" && martialArt.role !== "DPS") return "❌ 指定武学不属于 DPS";
    if (reserveType.value !== "DPS" && martialArt) return "❌ 只有 DPS 预留需要指定武学";

    const loaded = await loadSnapshot(admin.qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    try {
      await team.quickReserve(
        admin.qq,
        resolved.team.id,
        reserveType.value,
        count,
        martialArt?.index ?? null,
      );
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ ${resolved.team.name} 已设置 ${reserveType.label}${martialArt ? `·${martialArt.label}` : ""} 预留 ${count} 个`;
  }

  async function cmdSetRules(senderId, args) {
    const admin = await requireAdmin(senderId);
    if (admin.error) return admin.error;
    const [teamName, ...ruleParts] = args;
    const rule = TEAM_RULES[ruleParts.join("")];
    if (!teamName || !rule) {
      return "❌ 格式：设置规则 <团队> <仅T奶|取消仅T奶|唯一QQ|取消唯一QQ>";
    }

    const loaded = await loadSnapshot(admin.qq);
    if (loaded.error) return loaded.error;
    const resolved = resolveTeam(loaded.snapshot.teams ?? [], teamName);
    if (resolved.error) return resolved.error;
    try {
      await team.updateTeam(admin.qq, resolved.team.id, rule.patch);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ ${resolved.team.name} ${rule.reply}`;
  }

  const COMMANDS = {
    报名: cmdSignup,
    取消: cmdCancel,
    退出: cmdCancel,
    我的报名: cmdMySignups,
    团队: cmdTeams,
    帮助: async () => HELP_TEXT,
    开团: cmdCreateTeam,
    改名: cmdRenameTeam,
    删团: cmdDeleteTeam,
    锁定: (senderId, args) => cmdSetTeamLock(senderId, args, true),
    解锁: (senderId, args) => cmdSetTeamLock(senderId, args, false),
    代取消: cmdAdminCancel,
    快速预留: cmdQuickReserve,
    设置规则: cmdSetRules,
  };

  /**
   * 主入口：识别无 / 指令。普通聊天未命中时返回 handled: false。
   * 为兼容旧消息，仍允许显式 / 前缀并返回未知指令提示。
   */
  async function handle({ senderId, text: rawText, kind = "private" } = {}) {
    const text = stripMentions(rawText);
    const explicitPrefix = text.startsWith("/");
    const match = text.match(/^\/?([\u4e00-\u9fa5A-Za-z]+)\s*(.*)$/s);
    if (!match) return { handled: false };

    const name = match[1];
    const rest = match[2];
    const command = COMMANDS[name];
    if (!command) {
      if (!explicitPrefix) return { handled: false };
      return { handled: true, reply: `❌ 未知指令 ${name}，发送 帮助 查看可用指令` };
    }

    const throttleMessage = checkThrottle(senderId);
    if (throttleMessage) return { handled: true, reply: throttleMessage };

    try {
      return { handled: true, reply: await command(senderId, splitCommandArgs(rest), kind) };
    } catch (err) {
      console.error("[cmd] 指令执行失败:", err.message ?? err);
      return { handled: true, reply: `❌ 处理失败：${describeError(err)}` };
    }
  }

  return { handle };
}
