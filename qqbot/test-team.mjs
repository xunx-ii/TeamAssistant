/**
 * TeamAssistant OneBot 指令集成测试：mock 后端 + 真实指令处理器。
 */
import { createServer } from "node:http";
import { once } from "node:events";

const port = 18321;
const state = {
  teams: [
    {
      id: "team-1",
      name: "周常一团",
      weekStart: "2026-08-03",
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
  memberTokens: new Set(["10001", "10002"]),
};

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    let parsed = {};
    if (body) parsed = JSON.parse(body);
    state.requests.push({ method: request.method, path: url.pathname, body: parsed });
    const json = (value, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };

    if (url.pathname === "/api/v2/bootstrap") {
      return json({
        ok: true,
        teams: state.teams,
        userProfiles: { "10001": { nickname: "张三" }, "10002": { nickname: "李四" } },
      });
    }
    if (url.pathname === "/api/v2/slot-locks" && request.method === "POST") {
      return json({ ok: true, lockToken: `lock-${parsed.teamId}-${parsed.slotIndex}` });
    }
    const memberMatch = url.pathname.match(/^\/api\/v2\/teams\/([^/]+)\/slots\/(\d+)\/member$/);
    if (memberMatch && request.method === "PUT") {
      const slot = state.teams.find(team => team.id === memberMatch[1]).slots[Number(memberMatch[2])];
      slot.member = parsed.member;
      slot.status = "occupied";
      return json({ ok: true, dataVersion: 1 });
    }
    if (memberMatch && request.method === "DELETE") {
      const slot = state.teams.find(team => team.id === memberMatch[1]).slots[Number(memberMatch[2])];
      slot.member = null;
      slot.status = "empty";
      return json({ ok: true, dataVersion: 2 });
    }
    if (url.pathname.match(/^\/api\/v2\/slot-locks\/[^/]+\/\d+$/) && request.method === "DELETE") {
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

const commands = createCommandHandler({ isGroupMember: async qq => state.memberTokens.has(qq) });

try {
  let result = await commands.handle({ senderId: "10001", text: "/帮助", kind: "group" });
  check("帮助不再要求绑定", result.reply.includes("指令帮助") && !result.reply.includes("/绑定"), result.reply);

  result = await commands.handle({ senderId: "99999", text: "/报名 周常一团 外人 天策·傲血战意", kind: "group" });
  check("非群成员禁止报名", result.reply.includes("请先加入 QQ 群"), result.reply);

  result = await commands.handle({ senderId: "10001", text: "/报名 周常一团 张三 天策·傲血战意 #0", kind: "group" });
  check("群成员无需绑定直接报名", result.reply.includes("报名成功"), result.reply);
  const member = state.teams[0].slots[0].member;
  check("OneBot QQ 号自动关联", member?.qq === "10001", JSON.stringify(member));
  check("装分可省略并保存为空", member?.gearScore === "", JSON.stringify(member));

  result = await commands.handle({ senderId: "10002", text: "/团队 周常一团", kind: "group" });
  check("团队成员列表正常显示", result.reply.includes("周常一团") && result.reply.includes("张三"), result.reply);

  result = await commands.handle({ senderId: "10001", text: "/退出 周常一团", kind: "group" });
  check("群成员直接退出报名", result.reply.includes("已退出"), result.reply);
  check("退出后槽位为空", state.teams[0].slots[0].member === null);

  result = await commands.handle({ senderId: "10001", text: "/绑定 张三 10001", kind: "group" });
  check("绑定指令已移除", result.reply.includes("未知指令"), result.reply);

  const writePaths = state.requests.filter(item => item.path.includes("/slots/") && ["PUT", "DELETE"].includes(item.method));
  check("报名写入仍经过 OneBot 服务鉴权链路", writePaths.length === 2, JSON.stringify(writePaths));
  check("请求均使用真实 QQ 身份", state.requests.every(item => item.body?.actorQq !== "openid-user-1"));
} finally {
  const closed = once(server, "close");
  server.closeAllConnections();
  server.close();
  await closed;
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
}
