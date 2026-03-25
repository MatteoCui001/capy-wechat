/**
 * Context token store: in-memory Map + disk persistence.
 *
 * context_token is issued per-message by the Weixin getupdates API and must
 * be echoed verbatim in every outbound sendMessage. The in-memory map is the
 * primary lookup; disk persistence ensures tokens survive service restarts.
 *
 * Disk path: ~/.capy/wechat/context-tokens.json
 */

import fs from "node:fs";
import path from "node:path";
import { CONTEXT_TOKENS_FILE, logError, log } from "../config.ts";

const store = new Map<string, string>();

/** Get the context token for a user ID. */
export function get(userId: string): string | undefined {
  return store.get(userId);
}

/** Set (and persist) a context token for a user ID. */
export function set(userId: string, token: string): void {
  store.set(userId, token);
  save();
}

/** Restore context tokens from disk into the in-memory map. */
export function restore(): void {
  if (!fs.existsSync(CONTEXT_TOKENS_FILE)) return;
  try {
    const raw = fs.readFileSync(CONTEXT_TOKENS_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, string>;
    let count = 0;
    for (const [userId, token] of Object.entries(obj)) {
      if (typeof token === "string" && token) {
        store.set(userId, token);
        count++;
      }
    }
    log(`恢复 context token: ${count} 个`);
  } catch (err) {
    logError(`读取 context-tokens.json 失败: ${String(err)}`);
  }
}

/** Persist the current in-memory store to disk. */
export function save(): void {
  try {
    const dir = path.dirname(CONTEXT_TOKENS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of store) {
      obj[k] = v;
    }
    fs.writeFileSync(CONTEXT_TOKENS_FILE, JSON.stringify(obj, null, 0), "utf-8");
  } catch (err) {
    logError(`写入 context-tokens.json 失败: ${String(err)}`);
  }
}
