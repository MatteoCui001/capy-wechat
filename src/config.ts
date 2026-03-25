/**
 * Configuration, constants, logging, and credential loading for capy-wechat.
 */

import fs from "node:fs";
import path from "node:path";
import type { Account } from "./types.ts";

// ── Paths ──────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || "~";

export const CAPY_WECHAT_DIR = path.join(HOME, ".capy", "wechat");
export const CREDENTIALS_FILE = path.join(CAPY_WECHAT_DIR, "account.json");
export const SYNC_BUF_FILE = path.join(CAPY_WECHAT_DIR, "sync_buf.txt");
export const CONTEXT_TOKENS_FILE = path.join(CAPY_WECHAT_DIR, "context-tokens.json");
export const ALLOW_LIST_FILE = path.join(CAPY_WECHAT_DIR, "allowFrom.json");

export const AGENT_DIR = path.join(HOME, ".happycapy", "agents", "capy-default");

export const WORKSPACE_DIR =
  process.env.WORKSPACE_DIR ||
  process.cwd().replace(/\/capy-wechat$/, "");

// ── CDN ────────────────────────────────────────────────────────────────────

export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

// ── Timeouts ───────────────────────────────────────────────────────────────

export const LONG_POLL_MS = 35_000;
export const API_TIMEOUT_MS = 15_000;
export const CONFIG_TIMEOUT_MS = 8_000;
export const TYPING_TIMEOUT_MS = 5_000;
export const UPLOAD_TIMEOUT_MS = 30_000;

// ── Retry config ───────────────────────────────────────────────────────────

export const MAX_FAILURES = 3;
export const BACKOFF_MS = 30_000;
export const RETRY_MS = 2_000;

// ── Message limits ─────────────────────────────────────────────────────────

export const MAX_HISTORY_PER_USER = 20;
export const MAX_INPUT_LENGTH = 4_000;

// ── Regex patterns ─────────────────────────────────────────────────────────

export const WORK_TRIGGERS = /^(干活|工作|开工|工作模式|干活模式|#工作|#干活|work)$/i;
export const CASUAL_TRIGGERS = /^(休闲|聊天|放松|休息|休闲模式|聊天模式|#休闲|#聊天|casual)$/i;
export const WEB_SEARCH_RE = /最新|今天|今日|现在|最近|新闻|天气|股价|汇率|比赛|比分|上映|发布|搜索|查一下|帮我查|联网|网上|搜一下/;
export const URL_RE = /https?:\/\/[^\s\u4e00-\u9fff]{4,}/;

// ── Logging ────────────────────────────────────────────────────────────────

export function log(msg: string): void {
  const ts = new Date().toLocaleTimeString("zh-CN");
  process.stderr.write(`[${ts}] ${msg}\n`);
}

export function logError(msg: string): void {
  const ts = new Date().toLocaleTimeString("zh-CN");
  process.stderr.write(`[${ts}] ERROR: ${msg}\n`);
}

// ── Credentials ────────────────────────────────────────────────────────────

export function loadCredentials(): Account {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.error("未找到微信凭据，请先运行: bun setup.ts");
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8")) as Account;
  } catch (err) {
    console.error(`读取凭据失败: ${String(err)}`);
    process.exit(1);
  }
}

// ── Allow list ─────────────────────────────────────────────────────────────

/**
 * Load the allowFrom list from ~/.capy/wechat/allowFrom.json.
 * Returns null if the file doesn't exist (allow all).
 * Returns a Set of allowed sender user IDs if the file exists.
 */
export function loadAllowList(): Set<string> | null {
  if (!fs.existsSync(ALLOW_LIST_FILE)) return null;
  try {
    const raw = fs.readFileSync(ALLOW_LIST_FILE, "utf-8");
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) {
      logError(`allowFrom.json 格式错误，应为数组`);
      return null;
    }
    return new Set(list.filter((x): x is string => typeof x === "string"));
  } catch (err) {
    logError(`读取 allowFrom.json 失败: ${String(err)}`);
    return null;
  }
}

// ── AI Gateway ─────────────────────────────────────────────────────────────

export const AI_GATEWAY_URL =
  process.env.AI_GATEWAY_URL ||
  "https://ai-gateway.happycapy.ai/api/v1/chat/completions";

/** Standard chat model (supports vision). */
export const AI_MODEL = process.env.AI_MODEL || "anthropic/claude-sonnet-4.6";

/** Online / web-search model (real-time information). */
export const WEB_MODEL = process.env.WEB_MODEL || "perplexity/sonar";

// ── Persona ─────────────────────────────────────────────────────────────────

export function readAgentFile(name: string): string {
  try {
    return fs.readFileSync(path.join(AGENT_DIR, name), "utf-8").trim();
  } catch {
    return "";
  }
}

const soulMd = readAgentFile("SOUL.md");
const identityMd = readAgentFile("IDENTITY.md");
export const PERSONA = [soulMd, identityMd].filter(Boolean).join("\n\n");

export const CASUAL_SYSTEM_PROMPT = `${PERSONA}

你现在通过微信与用户聊天。
规则：
- 用简洁清晰的中文回复，除非用户使用其他语言
- 不使用 Markdown 格式（微信不渲染它），用纯文本
- 保持回复简短自然，像真实朋友聊天一样`;

export const WORK_SYSTEM_PROMPT = `${PERSONA}

你现在通过微信接收任务，可以真正动手干活。
规则：
- 用简洁清晰的中文回复，除非用户使用其他语言
- 不使用 Markdown 格式（微信不渲染），用纯文本
- 可以写代码、执行脚本、读写文件、搜索内容来完成用户任务
- 执行完后，用一两句话告诉用户结果`;
