/**
 * CasualBackend — AI Gateway chat backend.
 *
 * Handles:
 *   - URL detection → page fetch → summarisation
 *   - Web-search keyword detection → perplexity/sonar online model
 *   - Image recognition via vision API (imagePath → base64)
 *   - Normal conversation with per-user history context
 */

import fs from "node:fs";
import type { InboundMsg, ChatMessage } from "../types.ts";
import type { AIBackend } from "./types.ts";
import {
  AI_GATEWAY_URL,
  AI_MODEL,
  WEB_MODEL,
  CASUAL_SYSTEM_PROMPT,
  WEB_SEARCH_RE,
  URL_RE,
  MAX_HISTORY_PER_USER,
  MAX_INPUT_LENGTH,
  log,
  logError,
} from "../config.ts";
import { loadHistory, saveHistory, clearHistory } from "../messaging/history-store.ts";

// ── URL fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return stripped plain text (max ~3 000 chars).
 * Returns null if the fetch fails or the content type is not text-like.
 */
async function fetchUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CapyBot/1.0)" },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text") && !ct.includes("html") && !ct.includes("json")) return null;
    const raw = await resp.text();
    const plain = raw
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
    return plain || null;
  } catch {
    return null;
  }
}

// ── AI Gateway call helper ──────────────────────────────────────────────────

interface ChatCompletionResp {
  choices?: Array<{ message?: { content?: string } }>;
}

async function callGateway(
  model: string,
  messages: Array<{ role: string; content: unknown }>
): Promise<string> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const resp = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, max_tokens: 800 }),
  });
  if (!resp.ok) throw new Error(`AI Gateway HTTP ${resp.status}`);
  const data = (await resp.json()) as ChatCompletionResp;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── CasualBackend ───────────────────────────────────────────────────────────

export class CasualBackend implements AIBackend {
  /** Per-user conversation history. */
  private readonly histories = new Map<string, ChatMessage[]>();

  // ── History helpers ───────────────────────────────────────────────────────

  private getHistory(userId: string): ChatMessage[] {
    if (!this.histories.has(userId)) {
      // Try loading from disk first (survives restarts)
      const persisted = loadHistory(userId);
      this.histories.set(userId, persisted);
    }
    return this.histories.get(userId)!;
  }

  private addMessage(userId: string, role: ChatMessage["role"], content: string): void {
    const h = this.getHistory(userId);
    h.push({ role, content });
    if (h.length > MAX_HISTORY_PER_USER) {
      h.splice(0, h.length - MAX_HISTORY_PER_USER);
    }
    // Persist to disk after every message
    saveHistory(userId, h);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  reset(userId: string): void {
    this.histories.delete(userId);
    clearHistory(userId);
  }

  async ask(userId: string, msg: InboundMsg): Promise<string> {
    const safeText = msg.text.trim().slice(0, MAX_INPUT_LENGTH);

    // ── Image: vision API ─────────────────────────────────────────────────
    if (msg.imagePath) {
      return this.handleImage(userId, msg.imagePath, safeText);
    }

    // ── URL in message ────────────────────────────────────────────────────
    const urlMatch = safeText.match(URL_RE);
    if (urlMatch) {
      return this.handleUrl(userId, safeText, urlMatch[0]);
    }

    // ── Normal text message ───────────────────────────────────────────────
    this.addMessage(userId, "user", safeText);

    const needsWeb = WEB_SEARCH_RE.test(safeText);
    const model = needsWeb ? WEB_MODEL : AI_MODEL;

    let messages: Array<{ role: string; content: unknown }>;
    if (needsWeb) {
      messages = [
        { role: "user", content: `${safeText}\n\n（回复请用中文，不要用 Markdown，直接纯文本，简洁）` },
      ];
    } else {
      messages = [
        { role: "system", content: CASUAL_SYSTEM_PROMPT },
        ...this.getHistory(userId),
      ];
    }

    let reply: string;
    try {
      reply = await callGateway(model, messages);
      if (!reply) reply = "抱歉，我现在无法回复，请稍后再试。";
    } catch (err) {
      logError(`CasualBackend.ask chat failed: ${String(err)}`);
      reply = "抱歉，我现在无法回复，请稍后再试。";
    }

    this.addMessage(userId, "assistant", reply);
    return reply;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async handleImage(
    userId: string,
    imagePath: string,
    userText: string
  ): Promise<string> {
    let imageBase64: string;
    try {
      imageBase64 = fs.readFileSync(imagePath).toString("base64");
    } catch (err) {
      logError(`CasualBackend: cannot read image file ${imagePath}: ${String(err)}`);
      return "抱歉，无法读取图片，请重试。";
    }

    const prompt =
      userText && userText !== "[图片]"
        ? userText
        : "请描述这张图片的内容。用中文，简洁自然，不用 Markdown。";

    let reply: string;
    try {
      reply = await callGateway(AI_MODEL, [
        { role: "system", content: CASUAL_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ]);
      if (!reply) reply = "无法识别图片，请重试。";
    } catch (err) {
      logError(`CasualBackend: vision call failed: ${String(err)}`);
      reply = "抱歉，图片识别失败，请稍后再试。";
    }

    this.addMessage(userId, "user", `[用户发送了一张图片] ${prompt}`);
    this.addMessage(userId, "assistant", reply);
    log(`CasualBackend: image handled for user=${userId.split("@")[0]}`);
    return reply;
  }

  private async handleUrl(
    userId: string,
    safeText: string,
    url: string
  ): Promise<string> {
    const pageText = await fetchUrl(url);
    if (!pageText) {
      const reply =
        "抱歉，无法直接访问这个链接（可能需要登录或被限制访问）。\n你可以把页面内容复制给我，我来帮你分析。";
      this.addMessage(userId, "user", safeText);
      this.addMessage(userId, "assistant", reply);
      return reply;
    }

    const userQuery = safeText.replace(url, "").trim();
    const prompt = userQuery
      ? `用户发来了这个链接的内容，用户的问题是：${userQuery}\n\n页面内容如下：\n${pageText}`
      : `用户发来了这个链接，请总结页面的主要内容：\n${pageText}`;

    this.addMessage(userId, "user", `[链接: ${url}] ${userQuery || "请总结"}`);

    let reply: string;
    try {
      reply = await callGateway(AI_MODEL, [
        { role: "system", content: CASUAL_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${prompt}\n\n（用中文回复，纯文本，不用 Markdown）`,
        },
      ]);
      if (!reply) reply = "抱歉，无法解析该链接，请稍后再试。";
    } catch (err) {
      logError(`CasualBackend: URL summary failed: ${String(err)}`);
      reply = "抱歉，无法解析该链接，请稍后再试。";
    }

    this.addMessage(userId, "assistant", reply);
    return reply;
  }
}
