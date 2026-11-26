import test from "node:test";
import assert from "node:assert/strict";
import { buildTurnPrompt } from "../src/message-context.js";

test("turn prompt includes trusted OneBot sender identity", () => {
  const prompt = buildTurnPrompt("帮我看看我的报名情况", {
    senderQq: "10001",
    senderName: "兔兔小拘",
    kind: "group",
    groupId: "1013228497",
  });
  assert.match(prompt, /发送者QQ：10001/);
  assert.match(prompt, /发送者昵称：兔兔小拘/);
  assert.match(prompt, /会话类型：群聊/);
  assert.match(prompt, /群号：1013228497/);
  assert.match(prompt, /不要要求用户再次提供QQ号/);
  assert.match(prompt, /【用户消息】\n帮我看看我的报名情况$/);
});

test("turn prompt preserves ordinary text when identity is unavailable", () => {
  assert.equal(buildTurnPrompt("你好", {}), "你好");
  assert.equal(buildTurnPrompt("你好", { senderQq: "not-a-qq" }), "你好");
});

test("turn prompt normalizes sender display fields", () => {
  const prompt = buildTurnPrompt("测试", {
    senderQq: "10002",
    senderName: "  群\n名片  ",
    kind: "private",
    groupId: "1013228497",
  });
  assert.match(prompt, /发送者昵称：群 名片/);
  assert.match(prompt, /会话类型：私聊/);
  assert.doesNotMatch(prompt, /群号：1013228497/);
});
