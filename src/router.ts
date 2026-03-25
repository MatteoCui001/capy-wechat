/**
 * Message router — the single entry point for processing inbound messages.
 *
 * Responsibilities:
 *   - Mode-switch detection (work ↔ casual trigger words)
 *   - Allow-list enforcement (loadAllowList; null = allow all)
 *   - Image messages → always casual backend (vision)
 *   - Text messages → dispatched to casual or work backend based on per-user mode
 */

import type { InboundMsg } from "./types.ts";
import {
  WORK_TRIGGERS,
  CASUAL_TRIGGERS,
  loadAllowList,
  log,
} from "./config.ts";
import { CasualBackend } from "./backends/casual.ts";
import { WorkBackend } from "./backends/work.ts";

// ── Mode type ───────────────────────────────────────────────────────────────

type UserMode = "casual" | "work";

// ── Module-level singletons ─────────────────────────────────────────────────

const casual = new CasualBackend();
const work = new WorkBackend();

/** Per-user mode: defaults to "casual". */
const userModes = new Map<string, UserMode>();

/** Cached allow-list (loaded once at first use). */
let allowList: Set<string> | null | undefined = undefined; // undefined = not yet loaded

// ── Helper: allow-list check ────────────────────────────────────────────────

function isAllowed(userId: string): boolean {
  if (allowList === undefined) {
    allowList = loadAllowList();
  }
  // null means file absent → allow all
  if (allowList === null) return true;
  // empty set → allow all (backward-compatible)
  if (allowList.size === 0) return true;
  return allowList.has(userId);
}

// ── Helper: mode getters ────────────────────────────────────────────────────

function getMode(userId: string): UserMode {
  return userModes.get(userId) ?? "casual";
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Route an inbound message to the appropriate AI backend and return the reply.
 *
 * Returns null when the message should be silently ignored (sender not in
 * the allow-list).
 */
export async function routeMessage(
  userId: string,
  msg: InboundMsg
): Promise<string | null> {
  // ── Allow-list check ────────────────────────────────────────────────────
  if (!isAllowed(userId)) {
    log(`router: 拒绝未授权用户 ${userId.split("@")[0]}`);
    return null;
  }

  const trimmed = msg.text.trim();

  // ── Mode-switch commands ────────────────────────────────────────────────
  if (WORK_TRIGGERS.test(trimmed)) {
    userModes.set(userId, "work");
    work.reset(userId); // start a fresh claude session
    log(`router: 用户 ${userId.split("@")[0]} 切换到 work 模式`);
    return "已切换到干活模式，我可以写代码、执行脚本、读写文件了。\n\n说「休闲」可以切回聊天模式。";
  }

  if (CASUAL_TRIGGERS.test(trimmed)) {
    userModes.set(userId, "casual");
    casual.reset(userId); // clear chat history
    log(`router: 用户 ${userId.split("@")[0]} 切换到 casual 模式`);
    return "已切换到休闲模式，咱们来聊天吧。\n\n说「干活」可以切回干活模式。";
  }

  // ── Image → always casual (vision) ─────────────────────────────────────
  if (msg.imagePath) {
    return casual.ask(userId, msg);
  }

  // ── Text → route by mode ────────────────────────────────────────────────
  const mode = getMode(userId);
  log(`router: 分发到 ${mode} backend，user=${userId.split("@")[0]}`);
  return mode === "work" ? work.ask(userId, msg) : casual.ask(userId, msg);
}
