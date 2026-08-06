/**
 * 端到端测试：mock TeamAssistant 后端 + 指令流程
 * 运行：node test-team.mjs
 */
import { createServer } from "node:http";
import { execSync } from "node:child_process";

// ── 1. Mock 后端（模拟 api-v2：bootstrap / 槽位锁 / member 读写）──
const PORT = 18321;
const state = {
  teams: [
    {
      id: "team-1",
      name: "周常一团",
      weekStart: "2026-08-03",
      slots: Array.from({ length: 25 }, (_, i) => ({
        index: i,
        status: i === 3 ? "reserved" : i === 4 ? "fixed" : i === 2 ? "fixed" : i === 1 ? "occupied" : "empty",
        member: i === 1 ? { qq: "30003", characterId: "老王", martialArtIndex: "8", gearScore: "13000" } : null,
        fixedRole: i === 4 ? "DPS" : i === 2 ? "boss" : null,
        fixedMartialArtIndex: i === 4 ? "4" : null,
      })),
    },
    { id: "team-2", name: "二团", weekStart: "2026-08-03", slots: Array.from({ length: 25 }, (_, i) => ({ index: i, status: "empty", member: null })) },
  ],
  requestLog: [], // 记录请求序列，验证锁流程
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = body ? JSON.parse(body) : {};
    const path = url.pathname;
    state.requestLog.push({ method: req.method, path, body: parsed });

    const json = (obj, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (path === "/api/v2/bootstrap" && req.method === "GET") {
      return json({
        ok: true,
        teams: state.teams,
        userProfiles: {
          "60006": { nickname: "后端自动昵称" },
          "10001": { nickname: "旧昵称甲" },
        },
      });
    }
    if (path === "/api/v2/admin/check" && req.method === "GET") {
      const qq = url.searchParams.get("actorQq");
      const isAdmin = qq === "89906502";
      return json({ ok: true, isAdmin, passwordConfigured: isAdmin });
    }
    if (path === "/api/v2/admin/login" && req.method === "POST") {
      if (parsed.actorQq !== "89906502") return json({ ok: false, reason: "forbidden" }, 403);
      if (parsed.password !== "admin123") return json({ ok: false, reason: "invalidPassword" }, 403);
      return json({ ok: true, isAdmin: true, adminToken: "admin-token" });
    }
    if (path === "/api/v2/slot-locks" && req.method === "POST") {
      const slot = state.teams.find((t) => t.id === parsed.teamId)?.slots?.[parsed.slotIndex];
      if (slot?.member && slot.member.qq !== parsed.qq) {
        return json({ ok: false, lockedBy: slot.member.qq }, 409);
      }
      return json({ ok: true, lockToken: `lock-${parsed.teamId}-${parsed.slotIndex}` });
    }
    const memberMatch = path.match(/^\/api\/v2\/teams\/([^/]+)\/slots\/(\d+)\/member$/);
    if (memberMatch && req.method === "PUT") {
      const [, teamId, slotIndex] = memberMatch;
      const slot = state.teams.find((t) => t.id === teamId).slots[Number(slotIndex)];
      if (parsed.expectedMemberQq !== null && slot.member?.qq !== parsed.expectedMemberQq) {
        return json({ ok: false, reason: "slotChanged" }, 409);
      }
      slot.member = parsed.member;
      slot.status = "occupied";
      return json({ ok: true, dataVersion: 1 });
    }
    if (memberMatch && req.method === "DELETE") {
      const [, teamId, slotIndex] = memberMatch;
      const slot = state.teams.find((t) => t.id === teamId).slots[Number(slotIndex)];
      if (slot.member?.qq !== parsed.expectedMemberQq) {
        return json({ ok: false, reason: "slotChanged" }, 409);
      }
      slot.member = null;
      slot.status = "empty";
      return json({ ok: true, dataVersion: 1 });
    }
    const lockMatch = path.match(/^\/api\/v2\/slot-locks\/([^/]+)\/(\d+)$/);
    if (lockMatch && req.method === "DELETE") {
      return json({ ok: true });
    }
    return json({ ok: false, reason: "notFound" }, 404);
  });
});

// ── 2. 指令测试 ──
process.env.TEAMASSISTANT_BASE_URL = `http://127.0.0.1:${PORT}/api/v2`;
process.env.BOT_USER_RATE_LIMIT = "0"; // 测试连发指令，关闭节流
process.env.QQ_MARKDOWN = "false"; // 覆盖 .env，默认文本模式（markdown 用例内动态切换）

const { createCommandHandler } = await import("./src/commands.js");
const { config } = await import("./src/config.js");
const { deleteBinding, getBinding } = await import("./src/db.js");

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`✅ ${name}`);
  } else {
    failed++;
    console.log(`❌ ${name} ${extra}`);
  }
}

server.listen(PORT, async () => {
  const cmd = createCommandHandler();
  const S1 = "openid-user-1";
  const S2 = "openid-user-2";
  const SG = "openid-group-1";
  const SA = "openid-admin-1";
  const SA2 = "openid-admin-2";
  const SA3 = "openid-admin-3";
  const SU = "openid-sync-1";

  try {
    // 帮助（不依赖后端）
    let r = await cmd.handle(S1, "/帮助");
    check("帮助", r.handled && r.reply.includes("/绑定"), r.reply.slice(0, 30));

    // 未绑定报名
    r = await cmd.handle(S1, "/报名 一团 张三 天策·傲血战意 12000");
    check("未绑定先提示", r.handled && r.reply.includes("绑定"), r.reply.slice(0, 40));

    // 绑定
    r = await cmd.handle(S1, "/绑定 张三 10001");
    check("绑定成功", r.handled && r.reply.includes("昵称：张三") && r.reply.includes("10001"), r.reply);
    check("绑定落库", getBinding(S1).qq === "10001" && getBinding(S1).player_id === "张三");
    r = await cmd.handle(S1, "/绑定 李四ID 10001");
    check("重复绑定更新", r.reply.includes("已更新绑定") && r.reply.includes("李四ID"), r.reply);
    check("更新后 ID 落库", getBinding(S1).player_id === "李四ID");
    r = await cmd.handle(S1, "/绑定 张三 abc");
    check("非法 QQ 号", r.reply.includes("格式不正确"));

    // 报名（自动选空槽位 = 0）
    r = await cmd.handle(S1, "/报名 一团 张三 天策·傲血战意 12000");
    check("报名成功", r.reply.includes("报名成功") && r.reply.includes("[0]"), r.reply);
    check(
      "锁流程顺序（锁→保存→释放）",
      state.requestLog.some((l) => l.method === "POST" && l.path === "/api/v2/slot-locks"),
      JSON.stringify(state.requestLog.map((l) => l.method + l.path).slice(-5)),
    );
    const lockIdx = state.requestLog.map((l) => l.method + l.path).lastIndexOf("POST/api/v2/slot-locks");
    const putIdx = state.requestLog.map((l) => l.method + l.path).lastIndexOf("PUT/api/v2/teams/team-1/slots/0/member");
    const relIdx = state.requestLog.map((l) => l.method + l.path).lastIndexOf("DELETE/api/v2/slot-locks/team-1/0");
    check("锁流程顺序（POST锁 < PUT成员 < DELETE锁）", lockIdx < putIdx && putIdx < relIdx);

    // 重复报名同团队
    r = await cmd.handle(S1, "/报名 一团 张三2 傲血战意 11000 #5");
    check("重复报名拦截", r.reply.includes("你已在"), r.reply);

    // 武学必填
    r = await cmd.handle(S1, "/报名 一团 张三3");
    check("缺少武学提示", r.reply.includes("缺少武学"), r.reply);
    r = await cmd.handle(S1, "/报名 一团 张三3 12000");
    check("只填装分也算缺武学", r.reply.includes("缺少武学"), r.reply);

    // 指定槽位
    r = await cmd.handle(S2, "/绑定 李四 20002");
    check("用户2绑定", r.reply.includes("20002"));
    r = await cmd.handle(S2, "/报名 一团 李四 藏剑·问水诀 #5");
    check("指定槽位 #5", r.reply.includes("[5]"), r.reply);

    // 槽位冲突（#1 被老王占；新用户3 未报名过，可走到占用检查）
    r = await cmd.handle("openid-user-3", "/绑定 王五 40004");
    check("用户3绑定", r.reply.includes("40004"));
    r = await cmd.handle("openid-user-3", "/报名 一团 王五 易筋经 #1");
    check("占用槽位提示", r.reply.includes("已被占用"), r.reply);

    // 换绑时新 QQ 已被他人绑定 → 拒绝（防冒充约束在更新模式下仍生效）
    r = await cmd.handle(S1, "/绑定 张三2 40004");
    check("他人 QQ 换绑被拒", r.reply.includes("已被其他账号绑定"), r.reply);
    check("原绑定未被改动", getBinding(S1).qq === "10001" && getBinding(S1).player_id === "李四ID");

    // 单参数绑定：自动从后端 userProfiles 同步昵称作为 ID
    r = await cmd.handle(SU, "/绑定 60006");
    check("单参数绑定成功", r.reply.includes("绑定成功") && r.reply.includes("后端自动昵称"), r.reply);
    check("昵称自动同步落库", getBinding(SU).qq === "60006" && getBinding(SU).player_id === "后端自动昵称");

    // 武学名匹配（不带门派）
    r = await cmd.handle(S2, "/报名 二团 李四 云裳心经 9999");
    check("心法名匹配", r.reply.includes("七秀·云裳心经"), r.reply);

    // 预留/固定槽位跳过
    const occupiedTeam1 = state.teams[0].slots.filter((s) => s.status === "occupied").length;
    check("mock 状态正确", occupiedTeam1 === 3, `实际 ${occupiedTeam1}: ` + state.teams[0].slots.map((s) => `${s.index}:${s.status}`).filter((x) => !x.endsWith("empty")).join(" "));

    // 查看团队列表
    r = await cmd.handle(S1, "/团队");
    check("团队列表", r.reply.includes("周常一团") && r.reply.includes("二团"), r.reply.slice(0, 50));

    // 查看团队详情（文本模式）
    r = await cmd.handle(S1, "/团队 一团");
    check("团队详情", r.reply.includes("[0]") && r.reply.includes("张三") && r.reply.includes("预留"), r.reply.slice(0, 60));

    // 查看团队详情（markdown 5×5 网格，列优先 + 角色 emoji）
    config.qqMarkdown = true;
    r = await cmd.handle(S1, "/团队 一团");
    const gridLines = r.reply.split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));
    check(
      "markdown 5×5 列优先网格",
      r.reply.includes("| 槽位 0-4 | 槽位 5-9 | 槽位 10-14 | 槽位 15-19 | 槽位 20-24 |") &&
        gridLines.length === 6 && // 表头 + 5 行数据
        gridLines[1].includes("⚔傲血战意\\|张三") && gridLines[1].includes("⚔问水诀\\|李四") && // DPS ⚔，槽位 0 与 5 同排
        gridLines[2].includes("🛡洗髓经\\|老王") && // T 🛡，槽位 1 在第二行
        r.reply.includes("预留\\|💰老板") && // 老板位：预留|老板
        r.reply.includes("预留\\|💗云裳心经") && // 固定心法槽位：预留|心法（奶妈 💗）
        r.reply.includes("预留") &&
        r.reply.includes("### 周常一团"),
      `网格行数 ${gridLines.length}，内容: ${r.reply.slice(0, 110)}`,
    );
    config.qqMarkdown = false;

    // 群聊 @ 提及剥离
    r = await cmd.handle(S1, "<@!openid-bot> /团队 一团");
    check("剥离 @ 提及", r.reply.includes("周常一团"), r.reply.slice(0, 30));

    // 非指令消息不拦截
    r = await cmd.handle(S1, "今天天气怎么样");
    check("非指令放行", r.handled === false);

    // 未知指令
    r = await cmd.handle(S1, "/不知道");
    check("未知指令", r.reply.includes("未知指令"));

    // 退出
    r = await cmd.handle(S2, "/退出 一团");
    check("退出成功", r.reply.includes("已退出") && r.reply.includes("[5]"), r.reply);
    const s5 = state.teams[0].slots[5];
    check("槽位已清空", s5.status === "empty" && s5.member === null);

    // 未报名退出（用户2 已退出 [5]，此时一团无其报名）
    r = await cmd.handle(S2, "/退出 一团");
    check("未报名退出提示", r.reply.includes("没有报名"), r.reply);

    // 解绑
    r = await cmd.handle(S2, "/解绑");
    check("解绑成功", r.reply.includes("已解除"), r.reply);
    check("解绑落库", getBinding(S2) === null);

    // ── 管理员绑定流程 ──
    const deleteAll = async () => {
      for (const oid of [S1, S2, "openid-user-3", SA, SA2, SA3, SG, SU]) deleteBinding(oid);
    };
    await deleteAll();

    // 群聊绑定管理员 → 拒绝
    r = await cmd.handle(SA, "/绑定 老板 89906502", "group");
    check("群聊绑管理员拒绝", r.reply.includes("只能私聊绑定"), r.reply);

    // 私聊绑定管理员 → 要求密码
    r = await cmd.handle(SA, "/绑定 老板 89906502", "c2c");
    check("私聊绑管理员要密码", r.reply.includes("管理员密码"), r.reply);

    // 密码错误 → 提示并可重试
    r = await cmd.handle(SA, "wrong-password");
    check("密码错误提示", r.reply.includes("密码错误") && r.reply.includes("还可尝试 2 次"), r.reply);
    check("错误后未绑定", getBinding(SA) === null);

    // 密码正确 → 绑定成功
    r = await cmd.handle(SA, "admin123");
    check("密码正确绑定成功", r.reply.includes("绑定成功") && r.reply.includes("昵称：老板") && r.reply.includes("89906502"), r.reply);
    check("管理员绑定落库", getBinding(SA).qq === "89906502" && getBinding(SA).player_id === "老板");

    // 验证期间发指令 → 放弃验证（新用户）
    r = await cmd.handle(SA2, "/绑定 老板2 89906502", "c2c");
    check("第二次管理员密码流程", r.reply.includes("管理员密码"));
    r = await cmd.handle(SA2, "/帮助");
    check("验证中发指令放弃验证", r.reply.includes("指令帮助"));
    r = await cmd.handle(SA2, "admin123");
    check("放弃后密码不再生效", r.handled === false, JSON.stringify(r).slice(0, 40));

    // 密码 3 次错误 → 重新绑定
    r = await cmd.handle(SA3, "/绑定 老板3 89906502", "c2c");
    check("第三次管理员密码流程", r.reply.includes("管理员密码"));
    r = await cmd.handle(SA3, "bad1");
    r = await cmd.handle(SA3, "bad2");
    r = await cmd.handle(SA3, "bad3");
    check("3次错误要求重绑", r.reply.includes("重新发送 /绑定"), r.reply);
    r = await cmd.handle(SA3, "admin123");
    check("超限后密码无效", r.handled === false, JSON.stringify(r).slice(0, 40));

    // 普通号群聊绑定不受影响
    r = await cmd.handle(SG, "/绑定 群友 50005", "group");
    check("普通号群聊直接绑定", r.reply.includes("绑定成功"), r.reply);
    check("普通号绑定落库", getBinding(SG).qq === "50005" && getBinding(SG).player_id === "群友");

    // 清理测试绑定数据
    await deleteAll();

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
  } catch (err) {
    console.error("测试异常:", err);
    process.exit(1);
  } finally {
    server.close();
  }
});
