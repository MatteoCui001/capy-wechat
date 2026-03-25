/**
 * iLink API layer — wraps all WeChat ilink HTTP endpoints.
 * Extracted and simplified from service.ts and /tmp/package/src/api/api.ts.
 */

import crypto from "node:crypto";
import type {
  WeixinOpts,
  GetUpdatesResp,
  WeixinRawMessage,
  MessageItem,
  UploadedMedia,
} from "../types.ts";
import {
  MSG_TYPE_BOT,
  MSG_STATE_FINISH,
  MSG_ITEM_TEXT,
} from "../types.ts";
import {
  LONG_POLL_MS,
  API_TIMEOUT_MS,
  CONFIG_TIMEOUT_MS,
  TYPING_TIMEOUT_MS,
} from "../config.ts";

// ── Header helpers ─────────────────────────────────────────────────────────

/** X-WECHAT-UIN: random uint32 → decimal string → base64. */
export function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

export function buildHeaders(token: string, bodyLen?: number): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token.trim()}`,
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (bodyLen !== undefined) {
    headers["Content-Length"] = String(bodyLen);
  }
  return headers;
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────

/**
 * POST JSON to a Weixin ilink endpoint with timeout.
 * Returns the parsed response body.
 */
export async function postJSON(
  opts: WeixinOpts,
  endpoint: string,
  payload: unknown,
  timeoutMs?: number
): Promise<unknown> {
  const base = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  const url = new URL(endpoint, base).toString();
  const body = JSON.stringify(payload);
  const headers = buildHeaders(opts.token, Buffer.byteLength(body, "utf-8"));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── API methods ────────────────────────────────────────────────────────────

/**
 * Long-poll for new messages. On client timeout (AbortError) returns an
 * empty response with ret=0 so the caller can simply retry.
 */
export async function getUpdates(
  opts: WeixinOpts,
  buf: string
): Promise<GetUpdatesResp> {
  const timeout = opts.longPollTimeoutMs ?? LONG_POLL_MS;
  try {
    return (await postJSON(
      opts,
      "ilink/bot/getupdates",
      { get_updates_buf: buf, base_info: { channel_version: "1.0.0" } },
      timeout
    )) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: buf };
    }
    throw err;
  }
}

/**
 * Send a text message to a WeChat user.
 */
export async function sendMessage(
  opts: WeixinOpts,
  msg: {
    toUserId: string;
    text: string;
    contextToken: string;
  }
): Promise<void> {
  const clientId = `capy-wechat:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await postJSON(
    opts,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: msg.toUserId,
        client_id: clientId,
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: MSG_ITEM_TEXT, text_item: { text: msg.text } }],
        context_token: msg.contextToken,
      },
      base_info: { channel_version: "1.0.0" },
    },
    API_TIMEOUT_MS
  );
}

/**
 * Send a full WeixinMessage (used for media messages with custom item_list).
 */
export async function sendRawMessage(
  opts: WeixinOpts,
  rawMsg: {
    toUserId: string;
    contextToken?: string;
    itemList: MessageItem[];
  }
): Promise<void> {
  const clientId = `capy-wechat:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  await postJSON(
    opts,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: rawMsg.toUserId,
        client_id: clientId,
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: rawMsg.itemList,
        context_token: rawMsg.contextToken,
      },
      base_info: { channel_version: "1.0.0" },
    },
    API_TIMEOUT_MS
  );
}

/**
 * Fetch bot config (includes typing_ticket) for a given user.
 */
export async function getConfig(
  opts: WeixinOpts,
  userId: string,
  contextToken?: string
): Promise<{ ret?: number; errmsg?: string; typing_ticket?: string }> {
  return (await postJSON(
    opts,
    "ilink/bot/getconfig",
    {
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: { channel_version: "1.0.0" },
    },
    CONFIG_TIMEOUT_MS
  )) as { ret?: number; errmsg?: string; typing_ticket?: string };
}

/**
 * Send a typing indicator to a user.
 * status: 1 = typing, 2 = cancel typing.
 */
export async function sendTyping(
  opts: WeixinOpts,
  userId: string,
  ticket: string,
  status: 1 | 2
): Promise<void> {
  await postJSON(
    opts,
    "ilink/bot/sendtyping",
    {
      ilink_user_id: userId,
      typing_ticket: ticket,
      status,
      base_info: { channel_version: "1.0.0" },
    },
    TYPING_TIMEOUT_MS
  );
}

/**
 * Get a pre-signed CDN upload URL for a media file.
 */
export async function getUploadUrl(
  opts: WeixinOpts,
  params: {
    filekey: string;
    media_type: number;
    to_user_id: string;
    rawsize: number;
    rawfilemd5: string;
    filesize: number;
    thumb_rawsize?: number;
    thumb_rawfilemd5?: string;
    thumb_filesize?: number;
    no_need_thumb?: boolean;
    aeskey: string;
  }
): Promise<{ upload_param?: string; thumb_upload_param?: string }> {
  return (await postJSON(
    opts,
    "ilink/bot/getuploadurl",
    {
      ...params,
      base_info: { channel_version: "1.0.0" },
    },
    API_TIMEOUT_MS
  )) as { upload_param?: string; thumb_upload_param?: string };
}
