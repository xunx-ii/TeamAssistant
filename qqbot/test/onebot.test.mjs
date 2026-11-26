import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { OneBotClient, messageToText, normalizeGroupMember } from "../src/onebot.js";
import { normalizeEvent } from "../src/qq.js";

test("OneBot client authenticates, sends actions and receives events", async (t) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));

  let authorization = "";
  let eventEcho = null;
  server.on("connection", (socket, request) => {
    authorization = request.headers.authorization ?? "";
    socket.on("message", raw => {
      const frame = JSON.parse(raw.toString());
      if (frame.action === "get_group_member_list") {
        socket.send(JSON.stringify({ status: "ok", retcode: 0, data: [{ user_id: 10001 }], echo: frame.echo }));
      } else if (frame.action === "send_group_msg") {
        socket.send(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 99 }, echo: frame.echo }));
      }
    });
  });

  const client = new OneBotClient({
    url: `ws://127.0.0.1:${server.address().port}/`,
    accessToken: "onebot-test-token-123456",
    logger: { info() {}, warn() {}, error() {} },
  });
  client.onEvent = event => { eventEcho = event; };
  await client.start();
  assert.equal(authorization, "Bearer onebot-test-token-123456");
  assert.deepEqual(await client.getGroupMembers("1013228497"), [{ user_id: 10001 }]);
  assert.deepEqual(
    await client.sendText({ kind: "group", groupId: "1013228497", text: "hello" }),
    { message_id: 99 },
  );

  for (const socket of server.clients) {
    socket.send(JSON.stringify({ post_type: "notice", notice_type: "group_increase", group_id: 1013228497, user_id: 10002 }));
  }
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(eventEcho.notice_type, "group_increase");
  client.stop();
});

test("OneBot message and group member payloads normalize safely", () => {
  assert.equal(messageToText([
    { type: "at", data: { qq: "123" } },
    { type: "text", data: { text: " /帮助" } },
  ]), "/帮助");
  assert.equal(messageToText("[CQ:at,qq=10000] /团队 一团"), "/团队 一团");
  assert.deepEqual(normalizeGroupMember({ user_id: 10001, nickname: " 张三 ", card: " 队长 ", role: "owner", join_time: 10 }), {
    qq: "10001",
    nickname: "张三",
    card: "队长",
    role: "owner",
    joinTimeMs: 10_000,
  });
  assert.equal(normalizeGroupMember({ user_id: 0 }), null);
});

test("OneBot group messages only count as addressed when the bot is mentioned", () => {
  const message = normalizeEvent({
    post_type: "message",
    message_type: "group",
    self_id: 10000,
    user_id: 10001,
    group_id: 1013228497,
    message_id: 1,
    sender: { card: "群名片", nickname: "昵称" },
    message: [{ type: "at", data: { qq: "10000" } }, { type: "text", data: { text: "/帮助" } }],
  });
  assert.equal(message.senderId, "10001");
  assert.equal(message.senderName, "群名片");
  assert.equal(message.content, "/帮助");
  assert.equal(message.mentionedSelf, true);
});
