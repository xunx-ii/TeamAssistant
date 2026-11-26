import { OneBotClient, messageToText } from "./onebot.js";
import { config } from "./config.js";

const MAX_TEXT_LENGTH = 3900;
const MESSAGE_DEDUP_LIMIT = 2_000;

function normalizeSenderName(event) {
  const sender = event?.sender ?? {};
  return String(sender.card || sender.nickname || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 128);
}

function normalizeEvent(event) {
  if (event?.post_type !== "message" || String(event.user_id ?? "") === String(event.self_id ?? "")) return null;
  const userId = String(event.user_id ?? "").trim();
  if (!/^\d{5,20}$/.test(userId)) return null;
  if (event.message_type === "group") {
    const groupId = String(event.group_id ?? "").trim();
    if (!/^\d{5,20}$/.test(groupId)) return null;
    return {
      kind: "group",
      senderId: userId,
      senderName: normalizeSenderName(event),
      groupId,
      content: messageToText(event.message),
      messageId: String(event.message_id ?? ""),
      mentionedSelf: Array.isArray(event.message)
        ? event.message.some(segment => segment?.type === "at" && String(segment.data?.qq ?? "") === String(event.self_id ?? ""))
        : typeof event.message === "string" && event.message.includes(`[CQ:at,qq=${event.self_id}]`),
      event,
    };
  }
  if (event.message_type === "private") {
    return {
      kind: "private",
      senderId: userId,
      senderName: normalizeSenderName(event),
      groupId: "",
      content: messageToText(event.message),
      messageId: String(event.message_id ?? ""),
      mentionedSelf: true,
      event,
    };
  }
  return null;
}

function truncate(text) {
  const value = String(text ?? "").trim();
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}\n…（内容过长已截断）` : value;
}

export async function createQQBot({
  onMessage,
  onEvent,
  onClient,
  onReady,
  onError,
} = {}) {
  const client = new OneBotClient({
    url: config.oneBotUrl,
    accessToken: config.oneBotAccessToken,
  });
  const recent = new Set();
  const send = {
    reply: async (message, content) => {
      const text = truncate(content);
      if (!text) return null;
      return client.sendText({ kind: message.kind, groupId: message.groupId, userId: message.senderId, text });
    },
    typing: async () => undefined,
  };

  let stopped = false;
  client.onEvent = async (event) => {
    try {
      await onEvent?.(event);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
    const message = normalizeEvent(event);
    if (!message || !message.content) return;
    const dedupeKey = `${message.kind}:${message.messageId || `${message.senderId}:${Date.now()}`}`;
    if (recent.has(dedupeKey)) return;
    recent.add(dedupeKey);
    if (recent.size > MESSAGE_DEDUP_LIMIT) recent.delete(recent.values().next().value);
    try {
      await onMessage?.(message, send);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      await send.reply(message, "⚠️ 处理消息时出现错误，请稍后再试").catch(() => undefined);
    }
  };

  try {
    onClient?.(client);
    await client.start();
    await onReady?.();
  } catch (error) {
    onError?.(error);
    throw error;
  }

  return {
    client,
    stop() {
      if (stopped) return;
      stopped = true;
      client.stop();
    },
  };
}

export { normalizeEvent };
