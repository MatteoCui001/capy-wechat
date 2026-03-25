/**
 * High-level message sending helpers for capy-wechat.
 *
 * Covers: text (with auto-splitting), image, file, and video.
 * All functions use sendMessage / sendRawMessage from ilink/api.ts.
 */

import type { WeixinOpts, UploadedMedia } from "../types.ts";
import {
  MSG_ITEM_TEXT,
  MSG_ITEM_IMAGE,
  MSG_ITEM_FILE,
  MSG_ITEM_VIDEO,
} from "../types.ts";
import { sendMessage, sendRawMessage } from "../ilink/api.ts";
import { log } from "../config.ts";

// ── Constants ───────────────────────────────────────────────────────────────

/** Maximum characters per outbound text chunk. */
const MAX_CHUNK = 3800;

/** Delay between consecutive text chunks (ms). */
const CHUNK_DELAY_MS = 200;

// ── Text splitting ──────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split a long string into chunks of at most maxLen characters.
 * Tries to split on paragraph breaks (\n\n), then single newlines (\n),
 * then sentence-ending punctuation (。), then hard-cuts at maxLen.
 */
export function splitText(text: string, maxLen: number = MAX_CHUNK): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try \n\n
    let idx = remaining.lastIndexOf("\n\n", maxLen);
    if (idx > 0) {
      chunks.push(remaining.slice(0, idx).trimEnd());
      remaining = remaining.slice(idx + 2).trimStart();
      continue;
    }

    // Try \n
    idx = remaining.lastIndexOf("\n", maxLen);
    if (idx > 0) {
      chunks.push(remaining.slice(0, idx).trimEnd());
      remaining = remaining.slice(idx + 1).trimStart();
      continue;
    }

    // Try 。
    idx = remaining.lastIndexOf("。", maxLen);
    if (idx > 0) {
      chunks.push(remaining.slice(0, idx + 1));
      remaining = remaining.slice(idx + 1).trimStart();
      continue;
    }

    // Hard cut
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Send a text message to a WeChat user, automatically splitting messages
 * longer than MAX_CHUNK characters. Chunks are sent with a 200 ms delay
 * between them to avoid rate-limiting.
 *
 * @param opts         WeixinOpts
 * @param toUserId     Recipient user ID
 * @param text         Full text to send
 * @param contextToken Context token from the most recent inbound message
 */
export async function sendText(
  opts: WeixinOpts,
  toUserId: string,
  text: string,
  contextToken: string
): Promise<void> {
  const chunks = splitText(text);
  log(`sendText: to=${toUserId} chunks=${chunks.length} totalLen=${text.length}`);
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await delay(CHUNK_DELAY_MS);
    await sendMessage(opts, { toUserId, text: chunks[i], contextToken });
  }
}

/**
 * Send an image message (previously uploaded to CDN) to a WeChat user.
 * Optionally include a text caption sent as a separate message first.
 *
 * ImageItem fields set:
 *   media.encrypt_query_param — CDN download param
 *   media.aes_key             — AES-128-ECB key, base64(hex) encoded
 *   media.encrypt_type        — 1
 *   mid_size                  — ciphertext file size
 *
 * @param opts         WeixinOpts
 * @param toUserId     Recipient user ID
 * @param uploaded     Result from uploadMedia()
 * @param contextToken Context token
 * @param caption      Optional text caption (sent before the image)
 */
export async function sendImage(
  opts: WeixinOpts,
  toUserId: string,
  uploaded: UploadedMedia,
  contextToken: string,
  caption?: string
): Promise<void> {
  if (caption) {
    await sendText(opts, toUserId, caption, contextToken);
    await delay(CHUNK_DELAY_MS);
  }

  log(`sendImage: to=${toUserId} filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
  await sendRawMessage(opts, {
    toUserId,
    contextToken,
    itemList: [
      {
        type: MSG_ITEM_IMAGE,
        image_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            // The SDK encodes aeskey as base64(hex string) — match that convention.
            aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
            encrypt_type: 1,
          },
          mid_size: uploaded.fileSizeCiphertext,
        },
      },
    ],
  });
}

/**
 * Send a file attachment (previously uploaded to CDN) to a WeChat user.
 *
 * FileItem fields set:
 *   media.encrypt_query_param — CDN download param
 *   media.aes_key             — AES-128-ECB key, base64(hex) encoded
 *   media.encrypt_type        — 1
 *   file_name                 — original filename
 *   len                       — plaintext file size as a string
 *
 * @param opts         WeixinOpts
 * @param toUserId     Recipient user ID
 * @param uploaded     Result from uploadMedia()
 * @param fileName     Original filename to display in WeChat
 * @param contextToken Context token
 */
export async function sendFile(
  opts: WeixinOpts,
  toUserId: string,
  uploaded: UploadedMedia,
  fileName: string,
  contextToken: string
): Promise<void> {
  log(`sendFile: to=${toUserId} fileName=${fileName} filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
  await sendRawMessage(opts, {
    toUserId,
    contextToken,
    itemList: [
      {
        type: MSG_ITEM_FILE,
        file_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
            encrypt_type: 1,
          },
          file_name: fileName,
          len: String(uploaded.fileSize),
        },
      },
    ],
  });
}

/**
 * Send a video message (previously uploaded to CDN) to a WeChat user.
 *
 * VideoItem fields set:
 *   media.encrypt_query_param — CDN download param
 *   media.aes_key             — AES-128-ECB key, base64(hex) encoded
 *   media.encrypt_type        — 1
 *   video_size                — ciphertext file size
 *
 * @param opts         WeixinOpts
 * @param toUserId     Recipient user ID
 * @param uploaded     Result from uploadMedia()
 * @param contextToken Context token
 */
export async function sendVideo(
  opts: WeixinOpts,
  toUserId: string,
  uploaded: UploadedMedia,
  contextToken: string
): Promise<void> {
  log(`sendVideo: to=${toUserId} filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
  await sendRawMessage(opts, {
    toUserId,
    contextToken,
    itemList: [
      {
        type: MSG_ITEM_VIDEO,
        video_item: {
          media: {
            encrypt_query_param: uploaded.downloadEncryptedQueryParam,
            aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
            encrypt_type: 1,
          },
          video_size: uploaded.fileSizeCiphertext,
        },
      },
    ],
  });
}
