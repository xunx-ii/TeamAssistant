/**
 * 配置模块
 *
 * 读取 .env（若存在）并合并环境变量，解析 QQ 凭据与 pi 模型配置。
 * 凭据优先级：环境变量 > credentials.json（扫码绑定产物）。
 */
import { config as loadDotenv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

loadDotenv({ path: join(ROOT, ".env") });

const CREDENTIALS_PATH = join(ROOT, "credentials.json");

/** 读取扫码绑定产生的凭据文件，不存在则返回 null */
function loadCredentialsFile() {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  } catch {
    return null;
  }
}

/** 解析可选的 JSON 环境变量（如自定义请求头），非法时返回 undefined */
function parseOptionalJson(value) {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[config] 忽略非法 JSON 配置: ${value.slice(0, 60)}…`);
    return undefined;
  }
}

/** 支持环境变量注入的模型 API Key（key 为 pi 的 provider id） */
const API_KEY_ENV = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

// 凭据文件只解析一次（appId/appSecret 共用一个读取结果）
const credentialsFile = loadCredentialsFile();

/**
 * 自定义模型配置（CUSTOM_* 系列，见 .env.example）
 * 对接本地/自建服务（Ollama、vLLM、LM Studio、代理网关等），不依赖内置运营商。
 */
const customModel = {
  baseUrl: process.env.CUSTOM_BASE_URL || "",
  /** 协议类型：openai-completions / openai-responses / anthropic-messages / google-generative-ai */
  api: process.env.CUSTOM_API || "openai-completions",
  apiKey: process.env.CUSTOM_API_KEY || "",
  /** 模型名称（调用 API 时使用的模型 id） */
  model: process.env.CUSTOM_MODEL || "",
  name: process.env.CUSTOM_NAME || "",
  /** 上下文大小（tokens） */
  contextWindow: parseInt(process.env.CUSTOM_CONTEXT || "128000", 10),
  maxTokens: parseInt(process.env.CUSTOM_MAX_TOKENS || "16384", 10),
  /** 是否支持图片输入 */
  images: process.env.CUSTOM_IMAGES === "true",
  /** 是否支持思考/推理 */
  reasoning: process.env.CUSTOM_REASONING === "true",
  /** 自定义请求头（JSON 对象） */
  headers: parseOptionalJson(process.env.CUSTOM_HEADERS),
};

export const config = {
  /** QQ 环境：production 正式环境 / sandbox 沙箱环境 */
  qqEnv: process.env.QQ_ENV === "sandbox" ? "sandbox" : "production",
  /** QQ OpenAPI 域名（沙箱与正式不同，可被 QQ_BASE_URL 覆盖） */
  qqBaseUrl:
    process.env.QQ_BASE_URL ||
    (process.env.QQ_ENV === "sandbox"
      ? "https://api.sandbox.qq.com"
      : "https://api.sgroup.qq.com"),
  /** 扫码绑定的凭据（环境变量优先） */
  appId: process.env.QQ_APP_ID ?? credentialsFile?.appId ?? "",
  appSecret: process.env.QQ_APP_SECRET ?? credentialsFile?.appSecret ?? "",
  /** pi 模型配置 */
  model: process.env.PI_MODEL || "", // 形如 "anthropic/claude-sonnet-4-5"，留空自动选择
  /** 机器人人设提示词 */
  botPrompt: process.env.BOT_PROMPT || "你是一个乐于助人的 QQ 机器人。",
  /** 工具白名单（逗号分隔），留空使用 pi 全部内置工具（read/bash/edit/write/grep/find/ls） */
  tools: (process.env.BOT_TOOLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** 重启恢复记忆时注入的历史消息条数上限 */
  historyLimit: parseInt(process.env.BOT_HISTORY_LIMIT || "20", 10),
  /** 上游 API 最大并发数（同时执行的 pi 生成请求数） */
  maxConcurrency: parseInt(process.env.BOT_MAX_CONCURRENCY || "2", 10),
  /** 每个对话两次请求的最小间隔（秒），0 表示不限速 */
  userRateLimitSec: parseInt(process.env.BOT_USER_RATE_LIMIT || "3", 10),
  /** 排队等待上限（秒），超过则放弃并提示繁忙 */
  queueTimeoutSec: parseInt(process.env.BOT_QUEUE_TIMEOUT || "60", 10),
  /** 排队等待的最大请求数，超过则直接拒绝 */
  queueLimit: parseInt(process.env.BOT_QUEUE_LIMIT || "20", 10),
  /** TeamAssistant 后端地址（api-v2 基础路径） */
  teamBaseUrl: process.env.TEAMASSISTANT_BASE_URL || "http://127.0.0.1:23219/api/v2",
  /** 门禁关闭时的邀请码（可选，门禁开放时无需配置） */
  teamInviteToken: process.env.TEAMASSISTANT_INVITE_TOKEN || "",
  /** QQ 消息使用 markdown（需在 QQ 开放平台开通 markdown 消息权限，团队详情渲染为表格） */
  qqMarkdown: process.env.QQ_MARKDOWN === "true",
  /** 模型 API Key（pi 通过 ModelRuntime.setRuntimeApiKey 使用） */
  apiKeys: Object.fromEntries(
    Object.entries(API_KEY_ENV)
      .map(([provider, envName]) => [provider, process.env[envName] || ""])
      .filter(([, value]) => value),
  ),
  /** 自定义模型是否已配置 */
  hasCustomModel() {
    return Boolean(customModel.baseUrl && customModel.model);
  },
  /** 自定义模型配置（仅供 buildCustomModelsJson 使用） */
  get customModel() {
    return customModel;
  },
  /**
   * pi models.json 路径：
   *   PI_MODELS_FILE 指定 → 直接使用（高级用法，支持多 provider 完全自定义）
   *   配置了 CUSTOM_* → 生成 data/pi-models.json
   *   都没有 → undefined（pi 回退读取 ~/.pi/agent/models.json）
   */
  get modelsPath() {
    if (process.env.PI_MODELS_FILE) return process.env.PI_MODELS_FILE;
    return this.hasCustomModel() ? join(ROOT, "data", "pi-models.json") : undefined;
  },
  /** 是否已配置 QQ 凭据 */
  hasCredentials() {
    return Boolean(this.appId && this.appSecret);
  },
  get credentialsPath() {
    return CREDENTIALS_PATH;
  },
};

/**
 * 把 CUSTOM_* 配置生成为 pi models.json 内容。
 * apiKey 用 $CUSTOM_API_KEY 环境变量插值（不落盘明文）；
 * 未配置 apiKey 时写入占位值，兼容 Ollama 等免鉴权本地服务。
 */
export function buildCustomModelsJson() {
  return {
    providers: {
      custom: {
        baseUrl: customModel.baseUrl,
        api: customModel.api,
        apiKey: customModel.apiKey ? "$CUSTOM_API_KEY" : "unused",
        ...(customModel.headers ? { headers: customModel.headers } : {}),
        models: [
          {
            id: customModel.model,
            ...(customModel.name ? { name: customModel.name } : {}),
            contextWindow: customModel.contextWindow,
            maxTokens: customModel.maxTokens,
            input: customModel.images ? ["text", "image"] : ["text"],
            reasoning: customModel.reasoning,
          },
        ],
      },
    },
  };
}
