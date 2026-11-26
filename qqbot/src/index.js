/**
 * TeamAssistant OpenQQ OneBot v11 入口。
 *
 * 流程：连接 OpenQQ 正向 WebSocket → 同步群成员白名单 → 接收群/私聊消息
 * → 识别真实 QQ 号 → 执行报名指令或 AI 回复。
 */
import { config } from "./config.js";
import { createCommandHandler } from "./commands.js";
import { getOrCreateConversation } from "./db.js";
import { createGroupMembershipSync } from "./group-sync.js";
import { createQQBot } from "./qq.js";
import { createBotAgent } from "./agent.js";
import { createTeamClient } from "./team.js";

async function main() {
  if (!config.hasBotCredentials()) {
    console.error(
      "❌ 未配置 OpenQQ 或 TeamAssistant 内部凭据。\n" +
        "   请设置 OPENQQ_WS_URL、OPENQQ_ACCESS_TOKEN、TEAMASSISTANT_BOT_TOKEN 和 TEAMASSISTANT_QQ_GROUP_ID。",
    );
    process.exit(1);
  }

  console.log(`[boot] OpenQQ OneBot: ${config.oneBotUrl}`);
  console.log(`[boot] 报名白名单群: ${config.qqGroupId}`);
  if (config.hasCustomModel()) console.log(`[boot] 自定义模型: ${config.customModel.model}（${config.customModel.baseUrl}）`);
  else if (config.model) console.log(`[boot] 模型: ${config.model}`);
  if (!Object.keys(config.apiKeys).length && !config.hasCustomModel() && !process.env.PI_MODELS_FILE) {
    console.warn("[boot] 未配置模型 API Key，AI 闲聊可能使用 pi 已保存的登录凭据。");
  }

  const agent = await createBotAgent();
  const teamClient = createTeamClient();
  let membership = null;
  let oneBot = null;
  const commands = createCommandHandler({
    isGroupMember: qq => membership?.hasMember(qq) ?? false,
  });

  const bot = await createQQBot({
    onClient: client => {
      oneBot = client;
      membership = createGroupMembershipSync({
        oneBot: client,
        teamClient,
        groupId: config.qqGroupId,
        intervalMs: config.groupSyncIntervalMs,
        notify: text => client.sendText({ kind: "group", groupId: config.qqGroupId, text }),
      });
    },
    onEvent: event => membership?.handleEvent(event),
    onReady: async () => {
      console.log("[onebot] 已连接，开始同步群成员白名单");
      await membership?.start();
    },
    onError: error => console.error("[qqbot] 运行错误:", error.message ?? error),
    onMessage: async (message, send) => {
      if (message.kind === "group" && !message.mentionedSelf) return;
      if (!(await membership.hasMember(message.senderId))) {
        await send.reply(message, `请先加入 QQ 群 ${config.qqGroupId} 后再使用报名机器人。`);
        return;
      }

      const command = await commands.handle(message);
      if (command.handled) {
        if (command.reply) await send.reply(message, command.reply);
        return;
      }

      const conversation = getOrCreateConversation({
        kind: message.kind === "group" ? "group" : "c2c",
        peerId: message.kind === "group" ? message.groupId : message.senderId,
      });
      console.log(`[msg] ${message.kind} ${conversation.peerId} QQ=${message.senderId}: ${message.content}`);
      await send.typing(message);

      const result = await agent.handleMessage(conversation, message.content, {
        senderQq: message.senderId,
        senderName: message.senderName,
        kind: message.kind,
        groupId: message.groupId,
      });
      if (result.rateLimited) {
        await send.reply(message, `请求太频繁了，请 ${result.waitSec} 秒后再试。`);
      } else if (result.busy) {
        await send.reply(message, "机器人正忙，请稍后再试。");
      } else if (result.reply) {
        await send.reply(message, result.reply);
      }
    },
  });

  const shutdown = async () => {
    console.log("\n[shutdown] 正在退出…");
    try {
      membership?.stop();
      bot.stop();
      oneBot?.stop();
      await agent.dispose();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  console.error("[boot] 启动失败:", error.message ?? error);
  process.exit(1);
});
