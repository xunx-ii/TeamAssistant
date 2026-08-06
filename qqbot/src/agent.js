/**
 * pi 会话管理模块
 *
 * 每个 QQ 对话（私聊用户 / 群）对应一个常驻内存的 pi AgentSession（运行态）。
 * 对话历史的持久化由 SQLite 负责（见 db.js）：
 *   - 每轮消息实时落库；
 *   - 重启后从 SQLite 取最近 N 条历史，通过 appendSystemPromptOverride 注入新会话恢复记忆。
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildCustomModelsJson, config } from "./config.js";
import { appendMessage, getRecentMessages } from "./db.js";
import { Semaphore } from "./limiter.js";

/** 把 SQLite 中的历史消息格式化为 pi 可读的文本 */
function formatHistory(messages) {
  if (!messages.length) return "";
  const lines = messages.map((m) =>
    m.role === "user" ? `用户：${m.content}` : `助手：${m.content}`,
  );
  return `\n\n以下是该对话的过往聊天记录（机器人重启后恢复的记忆）：\n${lines.join("\n")}\n`;
}

/**
 * 创建机器人智能体运行时。
 * @returns {{ handleMessage(conv, text): Promise<object>, dispose(): Promise<void> }}
 */
export async function createBotAgent() {
  // 自定义模型：把 CUSTOM_* 配置生成为 pi models.json（apiKey 走环境变量插值，不落盘），
  // 或直接使用 PI_MODELS_FILE 指定的现有文件（支持多 provider 完全自定义）
  if (config.hasCustomModel() && !process.env.PI_MODELS_FILE) {
    mkdirSync(dirname(config.modelsPath), { recursive: true });
    writeFileSync(config.modelsPath, JSON.stringify(buildCustomModelsJson(), null, 2) + "\n", "utf8");
    console.log(`[agent] 已生成自定义模型配置: ${config.modelsPath}`);
  } else if (process.env.PI_MODELS_FILE) {
    console.log(`[agent] 使用自定义 models.json: ${process.env.PI_MODELS_FILE}`);
  }

  // 模型运行时：读取 ~/.pi/agent/auth.json（pi /login 的登录凭据），
  // 并注入 .env 中配置的 API Key
  const modelRuntime = await ModelRuntime.create({ modelsPath: config.modelsPath });
  for (const [provider, apiKey] of Object.entries(config.apiKeys)) {
    modelRuntime.setRuntimeApiKey(provider, apiKey);
  }

  // 可选：通过 PI_MODEL 指定模型（格式 provider/model-id）。
  // 优先从运行时查（可命中自定义 provider），再回退 pi 内置模型目录
  let model;
  if (config.model) {
    const slash = config.model.indexOf("/");
    const provider = config.model.slice(0, slash);
    const modelId = config.model.slice(slash + 1);
    model = modelRuntime.getModel(provider, modelId) ?? getModel(provider, modelId);
    if (!model) {
      console.warn(`[agent] 未找到模型 ${config.model}，将让 pi 自动选择可用模型`);
    }
  }

  // convId -> { session, busy: Promise, onText }
  const sessions = new Map();
  // convId -> 创建中的 Promise（单飞：避免并发消息对同一新对话重复建会话）
  const sessionPromises = new Map();
  // 模型可用性只检查一次（getAvailable 会触发网络刷新）
  let availabilityChecked = false;
  // 全局并发信号量：保护上游 API 的并发上限（多用户同时请求时排队执行）
  const concurrency = new Semaphore({
    max: config.maxConcurrency,
    queueLimit: config.queueLimit,
    timeoutMs: config.queueTimeoutSec * 1000,
  });
  // 用户级限速：每个对话记录上次请求的到达时间（convId -> timestamp）
  const lastRequestAt = new Map();
  const rateLimitMs = config.userRateLimitSec * 1000;

  /** 前置校验：没有可用模型时给出清晰提示（比 pi 内部报错友好），只检查一次 */
  async function assertModelsAvailable() {
    if (availabilityChecked) return;
    let models;
    try {
      models = await modelRuntime.getAvailable();
    } catch {
      return; // 刷新失败（如离线）：不阻塞，由 pi 在请求时给出具体错误
    }
    if (models.length === 0) {
      throw new Error(
        "没有可用的 AI 模型。请在 .env 中配置模型 API Key（如 DEEPSEEK_API_KEY）" +
          "和 PI_MODEL，或先运行 pi 完成 /login。",
      );
    }
    availabilityChecked = true;
  }

  /** 获取（或创建）某对话的 pi 会话，创建时注入 SQLite 中的历史记忆 */
  async function getOrCreateSession(convId) {
    const existing = sessions.get(convId);
    if (existing) return existing;
    // 并发消息到达时复用同一个创建过程，避免重复建会话
    const inFlight = sessionPromises.get(convId);
    if (inFlight) return inFlight;

    const creating = (async () => {
      await assertModelsAvailable();

      const history = getRecentMessages(convId, config.historyLimit);
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: getAgentDir(),
        // 追加（而非替换）系统提示词：保留 pi 默认智能体指令，
        // 额外注入机器人人设与 SQLite 中恢复的对话历史
        appendSystemPromptOverride: (base) => {
          const historyText = formatHistory(history);
          return [
            ...base,
            `【机器人人设】\n${config.botPrompt}`,
            ...(historyText ? [historyText] : []),
          ];
        },
      });
      await loader.reload();

      const { session } = await createAgentSession({
        model: model ?? undefined,
        modelRuntime,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        tools: config.tools.length ? config.tools : undefined,
      });

      const entry = {
        session,
        busy: Promise.resolve(),
        onText: null,
      };
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          entry.onText?.(event.assistantMessageEvent.delta);
        }
      });
      sessions.set(convId, entry);
      return entry;
    })();

    sessionPromises.set(convId, creating);
    try {
      return await creating;
    } finally {
      sessionPromises.delete(convId);
    }
  }

  /**
   * 处理一条用户消息。
   *
   * 流控（多用户场景，保护上游 API 并发上限）：
   *   1. 用户级限速 - 基于消息到达时间，每对话 rateLimitMs 内只处理第一条，其余拒绝
   *   2. 对话内串行 - 同一对话的消息在 busy 链上排队，避免 pi 会话状态冲突
   *   3. 全局并发  - 信号量限制同时执行的上游生成请求数，超出按 FIFO 排队
   *
   * 返回结果对象：
   *   { rateLimited: true, waitSec } - 该对话请求过快
   *   { busy: true }                 - 队列已满或排队超时
   *   { reply: string }              - 正常回复（可能为空字符串）
   */
  async function handleMessage(conv, text) {
    // 1. 用户级限速（基于到达时间判断，不受排队时长影响）
    const now = Date.now();
    const last = lastRequestAt.get(conv.id) ?? 0;
    const elapsed = now - last;
    if (rateLimitMs > 0 && elapsed < rateLimitMs) {
      return {
        rateLimited: true,
        waitSec: Math.max(1, Math.ceil((rateLimitMs - elapsed) / 1000)),
      };
    }
    lastRequestAt.set(conv.id, now);

    const entry = await getOrCreateSession(conv.id);
    const run = entry.busy.then(async () => {
      // 2. 全局并发许可（FIFO 排队；队满或超时返回 busy）
      const ok = await concurrency.acquire();
      if (!ok) return { busy: true };
      try {
        appendMessage(conv.id, "user", text);

        let reply = "";
        entry.onText = (delta) => {
          reply += delta;
        };
        try {
          await entry.session.prompt(text);
        } finally {
          entry.onText = null;
        }

        const trimmed = reply.trim();
        if (trimmed) appendMessage(conv.id, "assistant", trimmed);
        return { reply: trimmed };
      } finally {
        concurrency.release();
      }
    });
    // 队列继续前进（吞掉错误，由本次调用方处理）
    entry.busy = run.catch(() => {});
    return run;
  }

  /** 停止时释放所有 pi 会话 */
  async function dispose() {
    for (const { session } of sessions.values()) {
      try {
        session.dispose();
      } catch {
        // 忽略释放异常
      }
    }
    sessions.clear();
  }

  return { handleMessage, dispose };
}
