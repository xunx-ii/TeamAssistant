/**
 * TeamAssistant OneBot 指令集成测试：mock 后端 + 真实指令处理器。
 */
import { createServer } from "node:http";
import { once } from "node:events";

const port = 18321;
const adminQqs = new Set(["10001"]);
const state = {
  teams: [
    {
      id: "team-1",
      name: "周常一团",
      weekStart: "2026-08-03",
      config: {
        reservedSlots: [],
        locked: false,
        onlyTnSignup: false,
        uniqueQqSignup: false,
        publicSignup: true,
        publicAtMs: 0,
      },
      slots: Array.from({ length: 25 }, (_, index) => ({
        index,
        status: "empty",
        member: null,
        fixedRole: null,
        fixedMartialArtIndex: null,
      })),
    },
  ],
  requests: [],
  memberTokens: new Set(["10001", "10002", "10003"]),
  cancellations: [],
  teamLocks: new Set(),
};

function createSlots() {
  return Array.from({ length: 25 }, (_, index) => ({
    index,
    status: "empty",
    member: null,
    fixedRole: null,
    fixedMartialArtIndex: null,
  }));
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    let parsed = {};
    if (body) parsed = JSON.parse(body);
    state.requests.push({ method: request.method, path: url.pathname, query: url.search, body: parsed });
    const json = (value, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };

    if (url.pathname === "/api/v2/admin/check" && request.method === "GET") {
      const qq = url.searchParams.get("actorQq") ?? "";
      return json({ ok: true, isAdmin: adminQqs.has(qq), inGroup: state.memberTokens.has(qq), sessionValid: false });
    }
    if (url.pathname === "/api/v2/bootstrap") {
      return json({
        ok: true,
        teams: state.teams,
        userProfiles: {
          "10001": { nickname: "张三" },
          "10002": { nickname: "李四" },
          "10003": { nickname: "王五" },
        },
      });
    }
    if (url.pathname === "/api/v2/teams" && request.method === "POST") {
      const team = { ...parsed.team, slots: parsed.team.slots?.length ? parsed.team.slots : createSlots() };
      state.teams.push(team);
      return json({ ok: true, dataVersion: 2 });
    }
    const teamMatch = url.pathname.match(/^\/api\/v2\/teams\/([^/]+)$/);
    if (teamMatch && request.method === "PATCH") {
      const team = state.teams.find((item) => item.id === teamMatch[1]);
      if (!team) return json({ ok: false, reason: "notFound" }, 404);
      if (typeof parsed.name === "string") team.name = parsed.name;
      for (const key of ["onlyTnSignup", "uniqueQqSignup", "locked"]) {
        if (typeof parsed[key] === "boolean") team.config[key] = parsed[key];
      }
      return json({ ok: true, dataVersion: 3 });
    }
    if (teamMatch && request.method === "DELETE") {
      const index = state.teams.findIndex((item) => item.id === teamMatch[1]);
      if (index < 0) return json({ ok: false, reason: "notFound" }, 404);
      state.teams.splice(index, 1);
      if (!state.teams.length && parsed.fallbackTeam) state.teams.push({ ...parsed.fallbackTeam, slots: createSlots() });
      return json({ ok: true, dataVersion: 4 });
    }
    if (url.pathname === "/api/v2/team-locks" && request.method === "POST") {
      state.teamLocks.add(parsed.teamId);
      return json({ ok: true, lockVersion: 1 });
    }
    const unlockMatch = url.pathname.match(/^\/api\/v2\/team-locks\/([^/]+)$/);
    if (unlockMatch && request.method === "DELETE") {
      state.teamLocks.delete(unlockMatch[1]);
      return json({ ok: true, lockVersion: 2 });
    }
    const reserveMatch = url.pathname.match(/^\/api\/v2\/teams\/([^/]+)\/quick-reserve$/);
    if (reserveMatch && request.method === "POST") {
      return json({ ok: true, dataVersion: 5, reserve: parsed });
    }
    if (url.pathname === "/api/v2/slot-locks" && request.method === "POST") {
      return json({ ok: true, lockToken: `lock-${parsed.teamId}-${parsed.slotIndex}` });
    }
    const cancelMatch = url.pathname.match(/^\/api\/v2\/teams\/([^/]+)\/slots\/(\d+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      const team = state.teams.find((item) => item.id === cancelMatch[1]);
      const slot = team?.slots[Number(cancelMatch[2])];
      if (!team || !slot?.member) return json({ ok: false, reason: "slotChanged" }, 409);
      state.cancellations.push({ teamId: team.id, slotIndex: slot.index, memberQq: slot.member.qq, ...parsed });
      slot.member = null;
      slot.status = "empty";
      return json({ ok: true, dataVersion: 6 });
    }
    const memberMatch = url.pathname.match(/^\/api\/v2\/teams\/([^/]+)\/slots\/(\d+)\/member$/);
    if (memberMatch && request.method === "PUT") {
      const slot = state.teams.find((team) => team.id === memberMatch[1]).slots[Number(memberMatch[2])];
      slot.member = parsed.member;
      slot.status = "occupied";
      return json({ ok: true, dataVersion: 7 });
    }
    if (memberMatch && request.method === "DELETE") {
      const slot = state.teams.find((team) => team.id === memberMatch[1]).slots[Number(memberMatch[2])];
      slot.member = null;
      slot.status = "empty";
      return json({ ok: true, dataVersion: 8 });
    }
    if (/^\/api\/v2\/slot-locks\/[^/]+\/\d+$/.test(url.pathname) && request.method === "DELETE") {
      return json({ ok: true });
    }
    return json({ ok: false, reason: "notFound" }, 404);
  });
});

server.listen(port, "127.0.0.1");
await once(server, "listening");
process.env.TEAMASSISTANT_BASE_URL = `http://127.0.0.1:${port}/api/v2`;
process.env.TEAMASSISTANT_BOT_TOKEN = "test-bot-token-at-least-16-characters";
process.env.BOT_USER_RATE_LIMIT = "0";
process.env.QQ_MARKDOWN = "false";

const { createCommandHandler } = await import("./src/commands.js");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`✅ ${name}`);
  } else {
    failed += 1;
    console.log(`❌ ${name} ${detail}`);
  }
}

const commands = createCommandHandler({ isGroupMember: async (qq) => state.memberTokens.has(qq) });

try {
  let result = await commands.handle({ senderId: "10001", text: "帮助", kind: "group" });
  check("无前缀帮助可用", result.reply.includes("TeamAssistant 指令") && !result.reply.includes("/报名"), result.reply);

  result = await commands.handle({ senderId: "10003", text: "今天天气怎么样", kind: "group" });
  check("普通聊天不被误判为指令", result.handled === false, JSON.stringify(result));

  result = await commands.handle({ senderId: "10003", text: "/未知", kind: "group" });
  check("旧前缀未知指令有明确提示", result.handled && result.reply.includes("未知指令"), result.reply);

  result = await commands.handle({ senderId: "99999", text: "报名 周常一团 外人 傲血战意", kind: "group" });
  check("非群成员禁止报名", result.reply.includes("请先加入 QQ 群"), result.reply);

  result = await commands.handle({ senderId: "10001", text: "报名 周常一团 张三 天策·傲血战意 #0", kind: "group" });
  check("群成员无前缀直接报名", result.reply.includes("报名成功"), result.reply);
  const member = state.teams[0].slots[0].member;
  check("OneBot QQ 号自动关联", member?.qq === "10001", JSON.stringify(member));
  check("装分可省略并保存为空", member?.gearScore === "", JSON.stringify(member));

  result = await commands.handle({ senderId: "10001", text: "帮我看看我的报名情况", kind: "group" });
  check("自然语言报名查询使用 OneBot QQ", result.handled && result.reply.includes("周常一团") && result.reply.includes("张三"), result.reply);

  result = await commands.handle({ senderId: "10001", text: "取消 周常一团 临时有事", kind: "group" });
  check("群成员取消报名", result.reply.includes("已取消") && result.reply.includes("临时有事"), result.reply);
  check("取消后槽位为空", state.teams[0].slots[0].member === null);
  check("取消原因和后端记录正确", state.cancellations[0]?.reason === "临时有事" && state.cancellations[0]?.cancelledBy === "10001", JSON.stringify(state.cancellations[0]));

  result = await commands.handle({ senderId: "10002", text: "开团 周末二团 周2026-11-29", kind: "group" });
  check("非管理员不能开团", result.reply.includes("仅限 TeamAssistant 管理员"), result.reply);

  const beforeTeams = state.teams.length;
  result = await commands.handle({ senderId: "10001", text: "开团 周末二团 周2026-11-29", kind: "group" });
  const created = state.teams.at(-1);
  check("管理员快速开团", state.teams.length === beforeTeams + 1 && result.reply.includes("周末二团"), result.reply);
  check("开团自动使用完整空槽位", created?.slots.length === 25 && created?.weekStart === "2026-11-23", JSON.stringify(created));

  result = await commands.handle({ senderId: "10001", text: "改名 周末二团 周末三团", kind: "group" });
  check("管理员修改团队名称", result.reply.includes("周末三团") && created?.name === "周末三团", result.reply);

  result = await commands.handle({ senderId: "10001", text: "锁定 周末三团", kind: "group" });
  check("管理员暂停报名", result.reply.includes("暂停") && state.teamLocks.has(created?.id), result.reply);

  result = await commands.handle({ senderId: "10001", text: "解锁 周末三团", kind: "group" });
  check("管理员恢复报名", result.reply.includes("恢复") && !state.teamLocks.has(created?.id), result.reply);

  result = await commands.handle({ senderId: "10001", text: "设置规则 周末三团 仅T奶", kind: "group" });
  check("管理员设置报名规则", result.reply.includes("仅允许 T/治疗") && created?.config.onlyTnSignup === true, result.reply);

  result = await commands.handle({ senderId: "10001", text: "快速预留 周末三团 DPS 2 天策·傲血战意", kind: "group" });
  const reserveRequest = state.requests.find((item) => item.path.endsWith("/quick-reserve"));
  check("管理员快速预留 DPS", result.reply.includes("预留 2 个") && reserveRequest?.body.reserveType === "DPS" && reserveRequest?.body.count === 2, result.reply);

  await commands.handle({ senderId: "10003", text: "报名 周常一团 王五 云裳心经 #1", kind: "group" });
  result = await commands.handle({ senderId: "10001", text: "代取消 周常一团 10003 临时请假", kind: "group" });
  check("管理员代取消群员报名", result.reply.includes("已代 10003 取消"), result.reply);
  const adminCancellation = state.cancellations.at(-1);
  check("代取消保留管理员操作人", adminCancellation?.actorQq === "10001" && adminCancellation?.expectedMemberQq === "10003", JSON.stringify(adminCancellation));

  result = await commands.handle({ senderId: "10001", text: "/退出 周常一团", kind: "group" });
  check("旧前缀退出仍兼容", result.reply.includes("没有报名"), result.reply);

  const commandWritePaths = state.requests.filter((item) => item.path.includes("/slots/") && ["PUT", "DELETE", "POST"].includes(item.method));
  check("报名链路使用 OneBot 服务鉴权", commandWritePaths.every((item) => item.body?.actorQq !== "openid-user-1"), JSON.stringify(commandWritePaths));
} finally {
  const closed = once(server, "close");
  server.closeAllConnections();
  server.close();
  await closed;
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
}
