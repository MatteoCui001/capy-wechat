/**
 * Session management for capy-wechat.
 *
 * Handles:
 *   - sync_buf disk persistence (loadSyncBuf / saveSyncBuf)
 *   - errcode -14 (session expired) detection and pause constant
 */

import fs from "node:fs";
import { SYNC_BUF_FILE, CAPY_WECHAT_DIR, log, logError } from "./config.ts";
import type { GetUpdatesResp } from "./types.ts";

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * How long to pause polling when a session-expired error (errcode -14) is
 * received before retrying. 15 minutes in milliseconds.
 */
export const SESSION_PAUSE_MS = 15 * 60 * 1000;

// ── sync_buf persistence ────────────────────────────────────────────────────

/**
 * Load the saved sync_buf from disk.
 * Returns an empty string if the file does not exist or cannot be read.
 */
export function loadSyncBuf(): string {
  try {
    if (!fs.existsSync(SYNC_BUF_FILE)) return "";
    const val = fs.readFileSync(SYNC_BUF_FILE, "utf-8").trim();
    if (val) {
      log(`loadSyncBuf: restored sync_buf (${val.length} chars)`);
    }
    return val;
  } catch (err) {
    logError(`loadSyncBuf: failed to read ${SYNC_BUF_FILE}: ${String(err)}`);
    return "";
  }
}

/**
 * Persist the sync_buf to disk.
 * Creates the directory if it does not exist.
 *
 * @param buf  The sync_buf string from the most recent getUpdates response
 */
export function saveSyncBuf(buf: string): void {
  try {
    fs.mkdirSync(CAPY_WECHAT_DIR, { recursive: true });
    fs.writeFileSync(SYNC_BUF_FILE, buf, "utf-8");
  } catch (err) {
    logError(`saveSyncBuf: failed to write ${SYNC_BUF_FILE}: ${String(err)}`);
  }
}

// ── Session-expired detection ───────────────────────────────────────────────

/**
 * Returns true when the response carries errcode -14, which signals that the
 * bot session has expired and polling should be paused for SESSION_PAUSE_MS.
 *
 * @param resp  A GetUpdatesResp (or any object with an optional errcode field)
 */
export function isSessionExpired(resp: GetUpdatesResp): boolean {
  return resp.errcode === -14;
}
