/**
 * WorkBackend — runs `claude -p` as a subprocess with full tool access.
 *
 * Features:
 *   - Per-user claude session IDs for --resume support
 *   - 120 s subprocess timeout
 *   - JSON output parsing (result + session_id)
 */

import type { InboundMsg } from "../types.ts";
import type { AIBackend } from "./types.ts";
import {
  WORK_SYSTEM_PROMPT,
  WORKSPACE_DIR,
  MAX_INPUT_LENGTH,
  log,
  logError,
} from "../config.ts";

/** Timeout for the claude subprocess in milliseconds. */
const CLAUDE_TIMEOUT_MS = 120_000;

export class WorkBackend implements AIBackend {
  /** Per-user claude session IDs for --resume. */
  private readonly claudeSessions = new Map<string, string>();

  reset(userId: string): void {
    this.claudeSessions.delete(userId);
  }

  async ask(userId: string, msg: InboundMsg): Promise<string> {
    const safeInput = msg.text.trim().slice(0, MAX_INPUT_LENGTH);
    const sessionId = this.claudeSessions.get(userId);

    const args: string[] = [
      "-p",
      "--output-format",
      "json",
      "--system-prompt",
      WORK_SYSTEM_PROMPT,
      "--allowedTools",
      "Bash,Read,Write,Glob,Grep,Edit,WebFetch",
    ];
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    const proc = Bun.spawn(["claude", ...args], {
      stdin: new TextEncoder().encode(safeInput),
      stdout: "pipe",
      stderr: "pipe",
      cwd: WORKSPACE_DIR,
      env: { ...process.env },
    });

    const timeoutHandle = setTimeout(() => {
      proc.kill();
      log(`WorkBackend: 超时终止 claude 进程: user=${userId.split("@")[0]}`);
    }, CLAUDE_TIMEOUT_MS);

    let stdout = "";
    try {
      const [out] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      stdout = out;
    } finally {
      clearTimeout(timeoutHandle);
    }

    await proc.exited;

    try {
      const parsed = JSON.parse(stdout) as {
        result?: string;
        session_id?: string;
        is_error?: boolean;
      };

      if (parsed.session_id) {
        this.claudeSessions.set(userId, parsed.session_id);
      }

      if (parsed.is_error) {
        logError(`WorkBackend: claude reported is_error for user=${userId.split("@")[0]}`);
        return "抱歉，执行出错了，请稍后再试。";
      }

      return parsed.result?.trim() || "抱歉，我现在无法回复，请稍后再试。";
    } catch {
      // Not JSON — return raw stdout if available
      return stdout.trim() || "抱歉，我现在无法回复，请稍后再试。";
    }
  }
}
