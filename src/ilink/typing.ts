/**
 * Typing indicator management for the WeChat ilink API.
 * Extracted and refactored from service.ts.
 */

import type { WeixinOpts } from "../types.ts";
import { getConfig, sendTyping } from "./api.ts";
import { log } from "../config.ts";

// ── Typing ticket cache ────────────────────────────────────────────────────

/** userId -> typing_ticket */
const ticketCache = new Map<string, string>();

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch a typing ticket for the given user, falling back to cached value.
 * Returns an empty string if no ticket is available.
 */
export async function fetchTypingTicket(
  opts: WeixinOpts,
  userId: string,
  contextToken?: string
): Promise<string> {
  try {
    const resp = await getConfig(opts, userId, contextToken);
    if (resp.ret === 0 && resp.typing_ticket) {
      ticketCache.set(userId, resp.typing_ticket);
      return resp.typing_ticket;
    }
  } catch {
    // ignore — typing is best-effort
  }
  return ticketCache.get(userId) ?? "";
}

/**
 * Send a typing indicator status.
 * status: 1 = typing, 2 = cancel typing.
 * Errors are silently swallowed (typing is best-effort).
 */
export async function sendTypingStatus(
  opts: WeixinOpts,
  userId: string,
  ticket: string,
  status: 1 | 2
): Promise<void> {
  try {
    await sendTyping(opts, userId, ticket, status);
  } catch {
    // ignore — typing is best-effort
  }
}

/**
 * Run an async task while keeping the "typing…" indicator alive every 5 s.
 * Sends typing=1 before the task, refreshes every 5 s, and sends
 * typing=2 (cancel) when the task completes or throws.
 *
 * If no typing ticket is available, the task runs without any indicator.
 */
export async function withTyping<T>(
  opts: WeixinOpts,
  userId: string,
  contextToken: string,
  task: () => Promise<T>
): Promise<T> {
  const ticket = await fetchTypingTicket(opts, userId, contextToken);
  if (!ticket) return task();

  await sendTypingStatus(opts, userId, ticket, 1);
  const keepalive = setInterval(
    () => sendTypingStatus(opts, userId, ticket, 1),
    5_000
  );
  try {
    return await task();
  } finally {
    clearInterval(keepalive);
    sendTypingStatus(opts, userId, ticket, 2).catch(() => {});
  }
}
