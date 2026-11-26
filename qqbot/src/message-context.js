const QQ_PATTERN = /^\d{5,20}$/;
const GROUP_PATTERN = /^\d{5,20}$/;

function singleLine(value, maxLength) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * 给 AI 回合补充 OneBot 提供的可信发送者上下文。
 * 普通文本和无效身份保持原样，避免伪造不存在的 QQ。
 */
export function buildTurnPrompt(text, actor = {}) {
  const content = String(text ?? "");
  const senderQq = singleLine(actor.senderQq, 20);
  if (!QQ_PATTERN.test(senderQq)) return content;

  const senderName = singleLine(actor.senderName, 128);
  const groupId = singleLine(actor.groupId, 20);
  const isGroup = actor.kind === "group" && GROUP_PATTERN.test(groupId);
  const lines = [
    "【OneBot 可信消息上下文】",
    "本消息来自 OpenQQ OneBot v11 事件，以下身份由协议直接提供。",
    `发送者QQ：${senderQq}`,
    `会话类型：${isGroup ? "群聊" : "私聊"}`,
  ];
  if (senderName) lines.push(`发送者昵称：${senderName}`);
  if (isGroup) lines.push(`群号：${groupId}`);
  lines.push(
    "查询本人报名、取消报名或其他与当前用户身份有关的信息时，直接使用上述发送者QQ，不要要求用户再次提供QQ号。",
    "",
    "【用户消息】",
    content,
  );
  return lines.join("\n");
}
