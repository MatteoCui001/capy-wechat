/**
 * Main poll loop for capy-wechat.
 *
 * Restores sync_buf and context_tokens from disk, then runs an infinite
 * getUpdates loop. Each inbound user message is parsed, routed through the AI
 * backend, and replied to. Typing indicators are shown while the AI thinks.
 *
 * Error handling:
 *   - errcode -14 (session expired) → pause 15 minutes before retrying
 *   - Up to MAX_FAILURES consecutive failures → exponential back-off (BACKOFF_MS)
 *   - Individual message errors → friendly error reply sent to user
 */

import type { Account, WeixinOpts } from "./types.ts";
import { MSG_TYPE_USER } from "./types.ts";
import {
  MAX_FAILURES,
  BACKOFF_MS,
  RETRY_MS,
  log,
  logError,
} from "./config.ts";
import { getUpdates } from "./ilink/api.ts";
import { withTyping } from "./ilink/typing.ts";
import { parseMessage } from "./messaging/parse.ts";
import { sendText } from "./messaging/send.ts";
import * as contextStore from "./messaging/context-store.ts";
import { loadSyncBuf, saveSyncBuf, isSessionExpired, SESSION_PAUSE_MS } from "./session.ts";
import { routeMessage } from "./router.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Poll loop ────────────────────────────────────────────────────────────────

export async function runPollLoop(account: Account): Promise<never> {
  const opts: WeixinOpts = {
    baseUrl: account.baseUrl,
    token: account.token,
  };

  // Restore persisted state
  let buf = loadSyncBuf();
  contextStore.restore();

  log(`服务启动，账号: ${account.accountId}`);
  log("开始监听微信消息...");

  let failures = 0;

  while (true) {
    try {
      const resp = await getUpdates(opts, buf);

      // ── Session expired ──────────────────────────────────────────────
      if (isSessionExpired(resp)) {
        logError(`session 已过期 (errcode -14)，暂停 ${SESSION_PAUSE_MS / 60_000} 分钟...`);
        await sleep(SESSION_PAUSE_MS);
        failures = 0;
        continue;
      }

      // ── Other API errors ─────────────────────────────────────────────
      const hasError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (hasError) {
        failures++;
        logError(
          `getUpdates 失败 (${failures}): ret=${resp.ret} errcode=${resp.errcode} "${resp.errmsg ?? ""}"`
        );
        if (failures >= MAX_FAILURES) {
          failures = 0;
          log(`退避等待 ${BACKOFF_MS / 1000}s...`);
          await sleep(BACKOFF_MS);
        } else {
          await sleep(RETRY_MS);
        }
        continue;
      }

      failures = 0;

      // ── Persist sync_buf ─────────────────────────────────────────────
      if (resp.sync_buf) {
        buf = resp.sync_buf;
        saveSyncBuf(buf);
      } else if (resp.get_updates_buf) {
        buf = resp.get_updates_buf;
        saveSyncBuf(buf);
      }

      // ── Process messages ──────────────────────────────────────────────
      for (const rawMsg of resp.msgs ?? []) {
        if (rawMsg.message_type !== MSG_TYPE_USER) continue;

        const senderId = rawMsg.from_user_id ?? "unknown";

        // Parse the message (downloads + decrypts media if needed)
        const parsed = await parseMessage(rawMsg);

        // Skip empty messages
        if (!parsed.text.trim() && !parsed.imagePath) continue;

        // Update context token
        if (rawMsg.context_token) {
          contextStore.set(senderId, rawMsg.context_token);
        }

        const contextToken = contextStore.get(senderId);
        if (!contextToken) {
          log(`跳过 (无 context_token): ${senderId.split("@")[0]}`);
          continue;
        }

        const msgKind = parsed.imagePath ? "图片" : "文字";
        log(`收到消息: from=${senderId.split("@")[0]} kind=${msgKind} len=${parsed.text.length}`);

        // Route and reply
        try {
          const reply = await withTyping(opts, senderId, contextToken, () =>
            routeMessage(senderId, parsed)
          );

          // null = sender blocked by allow-list → silent drop
          if (reply === null) continue;

          await sendText(opts, senderId, reply, contextToken);
          log(`已回复: to=${senderId.split("@")[0]} len=${reply.length}`);
        } catch (err) {
          logError(`处理消息失败 user=${senderId.split("@")[0]}: ${String(err)}`);
          try {
            await sendText(opts, senderId, "抱歉，我遇到了一些问题，请稍后再试。", contextToken);
          } catch {
            // ignore secondary send error
          }
        }
      }
    } catch (err) {
      failures++;
      logError(`轮询异常 (${failures}): ${String(err)}`);
      if (failures >= MAX_FAILURES) {
        failures = 0;
        log(`退避等待 ${BACKOFF_MS / 1000}s...`);
        await sleep(BACKOFF_MS);
      } else {
        await sleep(RETRY_MS);
      }
    }
  }
}
