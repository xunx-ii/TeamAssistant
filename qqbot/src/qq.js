/**
 * QQ 客户端模块
 *
 * 基于腾讯官方 SDK @tencent-connect/qqbot-nodejs 的薄封装：
 * 创建机器人实例、接收消息、发送回复。
 * 官方 SDK 已处理 access_token 缓存刷新、WebSocket 心跳、断线续连（RESUME）、
 * 限流退避等协议细节。
 */
import { QQBot } from "@tencent-connect/qqbot-nodejs";
import { config } from "./config.js";

/** QQ 文本消息长度上限（保守取值） */
const MAX_TEXT_LENGTH = 3900;

/** 发送文本回复（msg 为收到的消息对象，自动携带被动回复所需的 msg_id） */
function sendTextReply(bot, msg, content) {
  if (!content?.trim()) return;
  let text = content.trim();
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + "\n…（内容过长已截断）";
  }
  return bot.sendText(msg.replyTarget, text);
}

/** 发送"对方正在输入"提示（仅私聊支持） */
async function sendTyping(bot, msg) {
  if (msg.kind !== "c2c") return;
  try {
    await bot.sendTyping(msg.replyTarget, 30);
  } catch {
    // 打字指示器失败不影响主流程
  }
}

/**
 * 创建并启动 QQ 机器人客户端。
 *
 * 消息回调签名：onMessage(ctx, msg, send)
 *   - send.reply(msg, content)：发送文本回复（自动截断超长内容）
 *   - send.typing(msg)：发送"对方正在输入"（仅私聊）
 *
 * send 捕获的是本函数内部的 bot 实例（事件触发时早已初始化），
 * 消息回调因此不依赖调用方任何外层变量，也不会遇到 TDZ/未初始化问题。
 *
 * @param {object} handlers - { onMessage(ctx, msg, send), onReady(data), onError(err) }
 * @returns {Promise<{ bot: QQBot, stop(): void }>}
 */
export async function createQQBot({ onMessage, onReady, onError } = {}) {
  const bot = new QQBot({
    appId: config.appId,
    appSecret: config.appSecret,
    baseUrl: config.qqBaseUrl,
    markdownSupport: config.qqMarkdown, // 开启后 sendText 自动以 markdown 消息发送（团队详情表格可渲染）
    logger: {
      info: (msg) => console.log(`[qqbot] ${msg}`),
      warn: (msg) => console.warn(`[qqbot] ${msg}`),
      error: (msg) => console.error(`[qqbot] ${msg}`),
      debug: () => {},
    },
  });

  if (onReady) bot.on("ready", onReady);
  if (onError) bot.on("error", onError);

  // 发送器：闭包捕获内部 bot，供消息回调使用（内部 bot 在此处已初始化）
  const send = {
    reply: (msg, content) => sendTextReply(bot, msg, content),
    typing: (msg) => sendTyping(bot, msg),
  };

  // 统一消息入口：私聊（c2c）与群 @（group）消息都会触发 message 事件
  bot.on("message", (ctx, msg) => {
    if (onMessage) onMessage(ctx, msg, send);
  });

  await bot.start();
  return { bot, stop: () => bot.stop() };
}
