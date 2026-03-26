/**
 * Persistent conversation history store.
 *
 * Saves per-user chat history to ~/.capy/wechat/history/<sanitized-userId>.json
 * so conversations survive service restarts.
 */

import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "../types.ts";
import { CAPY_WECHAT_DIR, MAX_HISTORY_PER_USER, log, logError } from "../config.ts";

const HISTORY_DIR = path.join(CAPY_WECHAT_DIR, "history");

/** Sanitize userId for use as filename (e.g. "abc@im.wechat" → "abc-im-wechat") */
function sanitizeId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function userFile(userId: string): string {
  return path.join(HISTORY_DIR, `${sanitizeId(userId)}.json`);
}

/** Ensure history directory exists. */
function ensureDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/** Load history for a single user from disk. Returns empty array if missing. */
export function loadHistory(userId: string): ChatMessage[] {
  try {
    const raw = fs.readFileSync(userFile(userId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        "role" in m &&
        "content" in m &&
        typeof (m as ChatMessage).role === "string" &&
        typeof (m as ChatMessage).content === "string"
    );
  } catch {
    return [];
  }
}

/** Save history for a single user to disk. Trims to MAX_HISTORY_PER_USER. */
export function saveHistory(userId: string, messages: ChatMessage[]): void {
  ensureDir();
  const trimmed = messages.length > MAX_HISTORY_PER_USER
    ? messages.slice(messages.length - MAX_HISTORY_PER_USER)
    : messages;
  try {
    fs.writeFileSync(userFile(userId), JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    logError(`history-store: 保存 ${sanitizeId(userId)} 失败: ${String(err)}`);
  }
}

/** Delete history for a user (used on mode reset). */
export function clearHistory(userId: string): void {
  try {
    fs.unlinkSync(userFile(userId));
  } catch {
    // file didn't exist, that's fine
  }
}

/** Restore all user histories from disk into a Map. Called at startup. */
export function restoreAllHistories(): Map<string, ChatMessage[]> {
  const map = new Map<string, ChatMessage[]>();
  ensureDir();
  try {
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(HISTORY_DIR, file);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // We store by sanitized ID in the filename, but we need the original ID
          // for the Map key. Since we also save from the original userId, the Map
          // will be re-populated when users send their first message after restart.
          // This function is mainly for pre-warming.
          const id = file.replace(/\.json$/, "");
          map.set(id, parsed);
        }
      } catch {
        // skip corrupt files
      }
    }
    if (map.size > 0) {
      log(`history-store: 恢复 ${map.size} 个用户的对话历史`);
    }
  } catch {
    // directory doesn't exist yet
  }
  return map;
}
