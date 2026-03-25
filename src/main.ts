#!/usr/bin/env bun
/**
 * Entry point for capy-wechat.
 *
 * Usage:
 *   AI_GATEWAY_API_KEY=<key> bun src/main.ts
 */

import { loadCredentials, log, logError } from "./config.ts";
import { runPollLoop } from "./poll.ts";

// ── Graceful shutdown ────────────────────────────────────────────────────────

process.on("SIGINT", () => {
  log("收到中断信号，正在退出...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("收到终止信号，正在退出...");
  process.exit(0);
});

// ── Main ────────────────────────────────────────────────────────────────────

const account = loadCredentials();
log(`账号加载成功: ${account.accountId}`);

runPollLoop(account).catch((err: unknown) => {
  logError(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
