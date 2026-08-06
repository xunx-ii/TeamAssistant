/**
 * 团队报名指令模块
 *
 * 消息以 / 开头（群聊 @ 后）即视为指令，命中后走 TeamAssistant 后端，
 * 不占用 pi 会话。所有指令返回 { handled, reply }：
 *   - handled: true  已作为指令处理（reply 为回复文本）
 *   - handled: false 不是指令，交由 AI 闲聊
 */
import { config } from "./config.js";
import { deleteBinding, getBinding, setBinding } from "./db.js";
import { findMartialArt } from "./martial-arts.js";
import { createTeamClient, describeError } from "./team.js";

const HELP_TEXT = `📖 指令帮助
/绑定 <昵称> <QQ号> 绑定你的昵称和 QQ 号（首次使用必做；重复绑定会更新）
/解绑             解除当前绑定
/报名 <团队> <角色名> <武学> [装分] [#槽位]
                  报名（武学必填），不指定槽位时自动选第一个空位
                  例：/报名 一团 张三 天策·傲血战意 12000
/退出 <团队>      退出该团队的报名
/团队 [名称]      团队列表，或查看指定团队详情
/帮助             显示本帮助`;

/** 剥离群聊消息中的 @ 提及标签，如 <@!openid>、<@openid> */
export function stripMentions(text) {
  return text.replace(/<@!?[^>]+>/g, "").trim();
}

/**
 * 创建指令处理器。
 * @returns {{ handle(senderId: string, text: string): Promise<{handled: boolean, reply?: string}> }}
 */
export function createCommandHandler() {
  const team = createTeamClient();
  // 轻量节流：senderId -> 上次指令时间（复用 BOT_USER_RATE_LIMIT 配置）
  const lastCommandAt = new Map();
  const throttleMs = config.userRateLimitSec * 1000;
  // 管理员密码待验证状态：senderId -> { qq, expiresAt, attempts }
  const pendingAdminAuth = new Map();
  const ADMIN_AUTH_TIMEOUT_MS = 60_000; // 密码输入窗口
  const ADMIN_AUTH_MAX_ATTEMPTS = 3; // 密码最多尝试次数

  /** 检查调用频率；超限时返回提示文本，正常返回 null */
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

  /** 需要绑定 QQ 号才能使用的指令：返回绑定信息或错误提示 */
  function requireBinding(senderId) {
    const binding = getBinding(senderId);
    if (!binding) {
      return { error: "你还没有绑定 QQ 号，请先发送：/绑定 <昵称> <QQ号>" };
    }
    return { qq: binding.qq, playerId: binding.player_id };
  }

  /** 按名称查找团队：精确 → 前缀 → 包含；多个匹配返回 null 并给出候选 */
  function findTeam(teams, name) {
    if (!name) return null;
    const exact = teams.find((t) => t.name === name);
    if (exact) return exact;
    const prefix = teams.filter((t) => t.name.startsWith(name));
    if (prefix.length === 1) return prefix[0];
    const includes = teams.filter((t) => t.name.includes(name));
    if (includes.length === 1) return includes[0];
    if (includes.length > 1) {
      return { ambiguous: true, names: includes.map((t) => t.name) };
    }
    return null;
  }

  /** 解析报名参数：剩余 token 中识别 槽位(#N) / 武学 / 装分 */
  function parseSignupArgs(tokens) {
    const parsed = {};
    for (const token of tokens) {
      if (!token) continue;
      const slotMatch = token.match(/^#(\d+)$/);
      if (slotMatch) {
        const idx = Number(slotMatch[1]);
        if (idx >= 0 && idx <= 24) parsed.slotIndex = idx;
        continue;
      }
      if (/^\d+$/.test(token)) {
        // 第一个纯数字视为装分
        if (parsed.gearScore === undefined) parsed.gearScore = token;
        continue;
      }
      const ma = findMartialArt(token);
      if (ma && parsed.martialArtIndex === undefined) {
        parsed.martialArt = ma;
        continue;
      }
      // 无法识别的 token：并入角色名（角色名可能含空格）
      parsed.characterId = [parsed.characterId, token].filter(Boolean).join(" ");
    }
    return parsed;
  }

  /** 槽位状态标签 */
  function slotLine(teamName, slot) {
    if (slot.status === "empty") return null;
    const idx = `[${slot.index}]`;
    if (slot.status === "reserved") return `${idx} 🔒预留`;
    if (slot.status === "fixed") {
      const ma = slot.fixedMartialArtIndex != null ? findMartialArt(String(slot.fixedMartialArtIndex)) : null;
      return `${idx} 固定(${slot.fixedRole ?? ""}${ma ? "·" + ma.label : ""})`;
    }
    // occupied
    const m = slot.member ?? {};
    const ma = findMartialArt(String(m.martialArtIndex ?? ""));
    const parts = [m.characterId || m.qq || "?"];
    if (ma) parts.push(ma.label);
    if (m.gearScore) parts.push(m.gearScore);
    return `${idx} ${parts.join(" · ")}`;
  }

  // ── 指令实现 ──

  /**
   * 绑定指令：/绑定 <昵称> <QQ号>（昵称可省略，省略时从后端自动同步）。
   * 省略昵称时自动从后端 userProfiles 同步该 QQ 的昵称；显式输入昵称优先。
   * 同一用户重复绑定会直接更新；目标 QQ 为管理员时走密码验证流程。
   */
  async function cmdBind(senderId, args, kind) {
    let id = (args[0] || "").trim();
    let qq = (args[1] || "").trim();
    // 兼容单参数：/绑定 <QQ号>，昵称由后端自动同步
    if (!qq && /^\d{5,12}$/.test(id)) {
      qq = id;
      id = "";
    }
    if (!qq || !/^\d{5,12}$/.test(qq)) {
      return "❌ 格式不正确，请发送：/绑定 <昵称> <QQ号>（QQ 号为纯数字）";
    }
    const existing = getBinding(senderId);

    // 管理员检测（GET /admin/check，无需鉴权；后端不可用时阻止绑定，防冒充）
    let isAdmin;
    try {
      isAdmin = await team.checkAdmin(qq);
    } catch (err) {
      return `❌ 无法验证 QQ 号是否为管理员（${describeError(err)}），请确认后端已启动后重试`;
    }

    // 未显式输入昵称时，从后端 userProfiles 同步（尽力而为，失败不影响绑定）
    if (!id) {
      try {
        const snapshot = await team.bootstrap(qq);
        id = snapshot.userProfiles?.[qq]?.nickname ?? "";
      } catch {
        // 昵称同步失败：保持为空
      }
    }

    if (isAdmin) {
      if (kind === "group") {
        return "⚠️ 该 QQ 号是管理员，只能私聊绑定，请私聊机器人完成绑定。";
      }
      // 私聊：进入密码验证
      pendingAdminAuth.set(senderId, { qq, playerId: id, expiresAt: Date.now() + ADMIN_AUTH_TIMEOUT_MS, attempts: 0 });
      return `🔐 检测到管理员 QQ（${qq}），请输入管理员密码完成绑定（${ADMIN_AUTH_TIMEOUT_MS / 1000} 秒内有效，最多 ${ADMIN_AUTH_MAX_ATTEMPTS} 次尝试）：`;
    }

    const result = setBinding(senderId, qq, id);
    if (!result.ok) return `❌ 绑定失败：${result.reason}`;
    const idText = id ? `，昵称：${id}` : "";
    if (existing) return `✅ 已更新绑定${idText}，QQ ${qq}`;
    return `✅ 绑定成功${idText}！QQ：${qq}`;
  }

  /** 提交管理员密码：验证通过后完成绑定 */
  async function submitAdminPassword(senderId, pending, password) {
    pending.attempts++;
    try {
      await team.adminLogin(pending.qq, password);
    } catch (err) {
      if (pending.attempts >= ADMIN_AUTH_MAX_ATTEMPTS) {
        pendingAdminAuth.delete(senderId);
        return `❌ ${describeError(err)}（已超过 ${ADMIN_AUTH_MAX_ATTEMPTS} 次尝试，请重新发送 /绑定）`;
      }
      return `❌ ${describeError(err)}（还可尝试 ${ADMIN_AUTH_MAX_ATTEMPTS - pending.attempts} 次）`;
    }
    const result = setBinding(senderId, pending.qq, pending.playerId);
    pendingAdminAuth.delete(senderId);
    if (!result.ok) return `❌ 绑定失败：${result.reason}`;
    const idText = pending.playerId ? `，昵称：${pending.playerId}` : "";
    return `✅ 管理员验证通过，绑定成功${idText}！QQ：${pending.qq}`;
  }

  async function cmdUnbind(senderId) {
    if (!getBinding(senderId)) return "你还没有绑定 QQ 号";
    deleteBinding(senderId);
    return "✅ 已解除绑定";
  }

  async function cmdSignup(senderId, args) {
    const binding = requireBinding(senderId);
    if (binding.error) return binding.error;
    const qq = binding.qq;

    const [teamName, ...rest] = args;
    if (!teamName || !rest.length) {
      return "❌ 格式不正确，请发送：/报名 <团队> <角色名> [武学] [装分] [#槽位]";
    }
    const parsed = parseSignupArgs(rest);
    if (!parsed.characterId) {
      return "❌ 缺少角色名，请发送：/报名 <团队> <角色名> <武学> [装分] [#槽位]";
    }
    if (!parsed.martialArt) {
      return "❌ 缺少武学（心法），请发送：/报名 <团队> <角色名> <武学> [装分] [#槽位]";
    }

    let snapshot;
    try {
      snapshot = await team.bootstrap(qq);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    const target = findTeam(snapshot.teams ?? [], teamName);
    if (!target) return `❌ 未找到团队「${teamName}」，可用 /团队 查看列表`;
    if (target.ambiguous) return `❌ 团队名称有歧义：${target.names.join("、")}，请写完整名称`;

    // 已在团队其他槽位报名（uniqueQqSignup 提前提示）
    const existingSlot = (target.slots ?? []).find(
      (s) => s.member && String(s.member.qq) === qq,
    );
    if (existingSlot) {
      return `⚠️ 你已在 ${target.name} 的 [${existingSlot.index}] 槽位报名，如需换位请先 /退出 ${target.name}`;
    }

    // 选槽位：指定 #N 或第一个空位
    let slot = null;
    if (parsed.slotIndex !== undefined) {
      slot = (target.slots ?? []).find((s) => s.index === parsed.slotIndex) ?? null;
      if (!slot) return `❌ 团队 ${target.name} 没有 [${parsed.slotIndex}] 号槽位`;
      if (slot.status !== "empty") return `❌ [${parsed.slotIndex}] 号槽位已被占用`;
    } else {
      slot = (target.slots ?? []).find((s) => s.status === "empty") ?? null;
      if (!slot) return `❌ 团队 ${target.name} 没有空槽位了`;
    }

    try {
      await team.signup(qq, target.id, slot.index, {
        characterId: parsed.characterId,
        martialArtIndex: parsed.martialArt?.index ?? "",
        gearScore: parsed.gearScore ?? "",
      });
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }

    const parts = [`✅ 报名成功：${target.name} [${slot.index}]`, parsed.characterId];
    if (parsed.martialArt) parts.push(parsed.martialArt.label);
    if (parsed.gearScore) parts.push(`装分 ${parsed.gearScore}`);
    return parts.join("\n");
  }

  async function cmdWithdraw(senderId, args) {
    const binding = requireBinding(senderId);
    if (binding.error) return binding.error;
    const qq = binding.qq;

    const teamName = (args[0] || "").trim();
    if (!teamName) return "❌ 请发送：/退出 <团队>";

    let snapshot;
    try {
      snapshot = await team.bootstrap(qq);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    const target = findTeam(snapshot.teams ?? [], teamName);
    if (!target) return `❌ 未找到团队「${teamName}」`;
    if (target.ambiguous) return `❌ 团队名称有歧义：${target.names.join("、")}，请写完整名称`;

    const mySlot = (target.slots ?? []).find((s) => s.member && String(s.member.qq) === qq);
    if (!mySlot) return `⚠️ 你在 ${target.name} 没有报名`;

    try {
      await team.withdraw(qq, target.id, mySlot.index, qq);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    return `✅ 已退出 ${target.name} 的 [${mySlot.index}] 槽位`;
  }

  async function cmdTeams(senderId, args) {
    const binding = requireBinding(senderId);
    if (binding.error) return binding.error;
    const qq = binding.qq;

    let snapshot;
    try {
      snapshot = await team.bootstrap(qq);
    } catch (err) {
      return `❌ ${describeError(err)}`;
    }
    const teams = snapshot.teams ?? [];
    if (!teams.length) return "📋 当前没有团队";

    const name = (args[0] || "").trim();

    // 查看列表
    if (!name) {
      const lines = teams.map((t) => {
        const slots = t.slots ?? [];
        const occupied = slots.filter((s) => s.status === "occupied").length;
        const reserved = slots.filter((s) => s.status === "reserved").length;
        return `· ${t.name}　${occupied}/${slots.length} 已报名${reserved ? `，${reserved} 预留` : ""}`;
      });
      return `📋 团队列表（${teams.length} 个）\n${lines.join("\n")}\n\n发送 /团队 <名称> 查看详情`;
    }

    // 查看详情
    const target = findTeam(teams, name);
    if (!target) return `❌ 未找到团队「${name}」`;
    if (target.ambiguous) return `❌ 团队名称有歧义：${target.names.join("、")}，请写完整名称`;

    const slots = target.slots ?? [];
    const occupied = slots.filter((s) => s.status !== "empty");

    // markdown 模式：25 个槽位排成 5×5 网格（列优先：第 1 列 0-4，第 2 列 5-9…），
    // 每格显示「心法|角色」；固定心法槽位显示「预留|心法」、老板位显示「预留|老板」。
    // 角色用 emoji 标记：老板💰 奶妈💗 DPS⚔ T🛡（QQ markdown 不支持字体颜色，用 emoji 代替）
    if (config.qqMarkdown) {
      const ROLE_EMOJI = { T: "🛡", 治疗: "💗", DPS: "⚔", boss: "💰" };
      const cell = (slot) => {
        if (!slot || slot.status === "empty") return "-";
        if (slot.status === "reserved") return "预留";
        if (slot.status === "fixed") {
          const ma = findMartialArt(String(slot.fixedMartialArtIndex ?? ""));
          if (ma) {
            return `预留\\|${ROLE_EMOJI[ma.role] ?? ""}${ma.name}`;
          }
          const role = slot.fixedRole || "";
          if (role) {
            const text = role === "boss" ? "老板" : role;
            return `预留\\|${ROLE_EMOJI[role] ?? ""}${text}`;
          }
          return "预留";
        }
        const m = slot.member ?? {};
        const ma = findMartialArt(String(m.martialArtIndex ?? ""));
        const emoji = ma ? ROLE_EMOJI[ma.role] ?? "" : "";
        const wuxue = ma ? ma.name : "?";
        const role = m.characterId || m.qq || "?";
        return `${emoji}${wuxue}\\|${role}`; // \| 为 markdown 表格内竖线转义
      };
      // 列优先：grid[row][col] = slots[col * 5 + row]
      const grid = Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 5 }, (_, col) => cell(slots[col * 5 + row])),
      );
      const table =
        `| 槽位 0-4 | 槽位 5-9 | 槽位 10-14 | 槽位 15-19 | 槽位 20-24 |\n` +
        `| --- | --- | --- | --- | --- |\n` +
        grid.map((row) => `| ${row.join(" | ")} |`).join("\n");
      const title = `### ${target.name}${target.weekStart ? `（周 ${target.weekStart}）` : ""}`;
      return `${title}\n\n${table}\n\n空位 ${slots.filter((s) => s.status === "empty").length} 个`;
    }

    // 文本模式（未开启 markdown）
    const lines = [];
    for (const slot of slots) {
      const line = slotLine(target.name, slot);
      if (line) lines.push(line);
    }
    const emptyCount = slots.filter((s) => s.status === "empty").length;
    const header = `📋 ${target.name}${target.weekStart ? `（周 ${target.weekStart}）` : ""}\n`;
    return header + (lines.length ? lines.join("\n") : "（暂无报名）") + `\n空位 ${emptyCount} 个`;
  }

  const COMMANDS = {
    "绑定": cmdBind,
    "解绑": cmdUnbind,
    "报名": cmdSignup,
    "退出": cmdWithdraw,
    "团队": cmdTeams,
    "帮助": async () => HELP_TEXT,
  };

  /**
   * 主入口：匹配并执行指令。不匹配返回 { handled: false }。
   * @param {string} senderId QQ openid
   * @param {string} rawText 原始消息文本
   * @param {string} kind 消息场景：'c2c'（私聊）/ 'group'（群聊）
   */
  async function handle(senderId, rawText, kind = "c2c") {
    const text = stripMentions(rawText ?? "");
    const match = text.match(/^\/([\u4e00-\u9fa5A-Za-z]+)\s*(.*)$/s);

    // 管理员密码验证窗口：过期则清除
    const pending = pendingAdminAuth.get(senderId);
    if (pending && Date.now() >= pending.expiresAt) {
      pendingAdminAuth.delete(senderId);
    }

    // 非指令消息：若正在等待管理员密码，视为密码提交
    if (!match) {
      const active = pendingAdminAuth.get(senderId);
      if (active && text.trim()) {
        try {
          return { handled: true, reply: await submitAdminPassword(senderId, active, text) };
        } catch (err) {
          console.error("[cmd] 密码验证失败:", err.message ?? err);
          return { handled: true, reply: `❌ 密码验证出错：${describeError(err)}` };
        }
      }
      return { handled: false };
    }

    const [name, rest] = [match[1], match[2]];
    const cmd = COMMANDS[name];
    if (!cmd) {
      return { handled: true, reply: `❌ 未知指令 /${name}，发送 /帮助 查看可用指令` };
    }

    // 验证期间发送了其他指令：放弃密码验证，正常执行
    if (pendingAdminAuth.has(senderId)) pendingAdminAuth.delete(senderId);

    const throttleMsg = checkThrottle(senderId);
    if (throttleMsg) return { handled: true, reply: throttleMsg };

    try {
      const args = rest.split(/\s+/).filter(Boolean);
      return { handled: true, reply: await cmd(senderId, args, kind) };
    } catch (err) {
      console.error("[cmd] 指令执行失败:", err.message ?? err);
      return { handled: true, reply: `❌ 处理失败：${describeError(err)}` };
    }
  }

  return { handle };
}
