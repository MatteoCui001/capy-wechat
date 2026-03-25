/**
 * Common interface for AI backend implementations.
 * Both CasualBackend (AI Gateway chat) and WorkBackend (claude -p) implement this.
 */

import type { InboundMsg } from "../types.ts";

export interface AIBackend {
  /**
   * Process an inbound message for a given user and return the AI reply.
   * Implementations maintain their own per-user state internally.
   */
  ask(userId: string, msg: InboundMsg): Promise<string>;

  /**
   * Reset all per-user state (history, session IDs, etc.) for the given user.
   */
  reset(userId: string): void;
}
