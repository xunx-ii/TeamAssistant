/**
 * QQ 机器人入口
 *
 * 流程：校验凭据 → 创建 pi 智能体运行时 → 连接 QQ 网关 →
 *       收到消息 → SQLite 落库 → pi 生成回复 → 发送。
 *
 * 用法：
 *   npm run bind     # 首次运行：扫码获取 AppID/AppSecret
 *   npm start        # 启动机器人
 */
import { config } from "./config.js";
import { createCommandHandler } from "./commands.js";
import { getOrCreateConversation } from "./db.js";
import { createQQBot } from "./qq.js";
import { createBotAgent } from "./agent.js";

async function main() {
  // ── 凭据检查 ──
  if (!config.hasCredentials()) {
    console.error(
      "❌ 未找到 QQ 机器人凭据。\n" +
        "   请先运行 `npm run bind` 扫码绑定，或在 .env 中设置 QQ_APP_ID / QQ_APP_SECRET。",
    );
    process.exit(1);
  }

  console.log(`[boot] QQ 环境: ${config.qqEnv}（${config.qqBaseUrl}）`);
  if (config.hasCustomModel()) console.log(`[boot] 自定义模型: ${config.customModel.model}（${config.customModel.baseUrl}）`);
  else if (config.model) console.log(`[boot] 模型: ${config.model}`);
  if (!Object.keys(config.apiKeys).length && !config.hasCustomModel() && !process.env.PI_MODELS_FILE) {
    console.warn(
      "[boot] 未配置模型 API Key 或自定义模型，将尝试使用 pi 已保存的登录凭据" +
        "（~/.pi/agent/auth.json，可先运行 `pi` 交互执行 /login）。",
    );
  }

  // ── pi 智能体运行时 ──
  const agent = await createBotAgent();

  // ── 团队报名指令处理器 ──
  const commands = createCommandHandler();

  // ── QQ 客户端 ──
  // send 由 qq.js 内部提供（绑定已初始化的 bot 实例），回调不再依赖外层变量
  const { stop } = await createQQBot({
    onReady: () => console.log("[qqbot] 已连接 QQ 网关，开始监听消息（Ctrl+C 退出）"),
    onError: (err) => console.error("[qqbot] 连接错误:", err.message),
    onMessage: async (ctx, msg, send) => {
      try {
        // 忽略机器人自己发出的消息与频道/私域消息
        if (msg.senderIsBot) return;
        if (msg.kind !== "c2c" && msg.kind !== "group") return;

        // 1. 指令拦截：/绑定 /报名 /退出 /团队 等（命中后不再走 AI）
        const cmdResult = await commands.handle(msg.senderId, msg.content, msg.kind);
        if (cmdResult.handled) {
          await send.reply(msg, cmdResult.reply);
          return;
        }

        // 2. AI 闲聊
        const conv = getOrCreateConversation({
          kind: msg.kind,
          peerId: msg.replyTarget.targetId,
        });
        console.log(`[msg] ${conv.kind} ${conv.peerId}: ${msg.content}`);

        // 生成期间显示"对方正在输入"（仅私聊）
        await send.typing(msg);

        // handleMessage 返回结果对象：限速拒绝 / 系统繁忙 / 正常回复
        const result = await agent.handleMessage(conv, msg.content);
        if (result.rateLimited) {
          await send.reply(msg, `⏳ 消息太频繁了，请 ${result.waitSec} 秒后再试～`);
        } else if (result.busy) {
          await send.reply(msg, "😅 机器人正忙，请稍后再试。");
        } else if (result.reply) {
          await send.reply(msg, result.reply);
        }
      } catch (err) {
        console.error("[msg] 处理失败:", err.message ?? err);
        // 给用户一个通用提示（不泄露内部错误细节）；发送失败只记日志，避免未处理拒绝
        try {
          await send.reply(msg, "⚠️ 我这边出错了，请稍后再试。");
        } catch (replyErr) {
          console.error("[msg] 错误提示发送失败:", replyErr.message ?? replyErr);
        }
      }
    },
  });

  // ── 优雅退出 ──
  const shutdown = async () => {
    console.log("\n[shutdown] 正在退出…");
    try {
      stop();
      await agent.dispose();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[boot] 启动失败:", err.message ?? err);
  process.exit(1);
});
