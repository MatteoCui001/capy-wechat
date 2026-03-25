/**
 * Parse a WeixinRawMessage into a structured InboundMsg.
 * Handles TEXT, VOICE, IMAGE, FILE, and VIDEO message types.
 * Downloads and decrypts encrypted CDN media as needed.
 */

import type { WeixinRawMessage, InboundMsg, MessageItem } from "../types.ts";
import {
  MSG_ITEM_TEXT,
  MSG_ITEM_IMAGE,
  MSG_ITEM_VOICE,
  MSG_ITEM_FILE,
  MSG_ITEM_VIDEO,
} from "../types.ts";
import { CDN_BASE_URL, log, logError } from "../config.ts";
import { downloadAndDecrypt, downloadPlain, saveTempMedia } from "../cdn/download.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Guess a reasonable file extension from a filename or default to the given fallback.
 */
function extFromFileName(fileName: string | undefined, fallback: string): string {
  if (!fileName) return fallback;
  const dot = fileName.lastIndexOf(".");
  if (dot >= 0 && dot < fileName.length - 1) {
    return fileName.slice(dot + 1).toLowerCase();
  }
  return fallback;
}

/**
 * Download and decrypt an encrypted CDN media item.
 * Returns the local temp file path, or undefined on failure.
 */
async function fetchEncryptedMedia(
  encryptQueryParam: string,
  aesKey: string,
  ext: string,
  cdnBaseUrl: string
): Promise<string | undefined> {
  try {
    const buf = await downloadAndDecrypt(cdnBaseUrl, encryptQueryParam, aesKey);
    return saveTempMedia(buf, ext);
  } catch (err) {
    logError(`fetchEncryptedMedia: download failed ext=${ext} err=${String(err)}`);
    return undefined;
  }
}

/**
 * Download a plain (non-encrypted) URL and save to temp file.
 * Returns the local temp file path, or undefined on failure.
 */
async function fetchPlainUrl(url: string, ext: string): Promise<string | undefined> {
  try {
    const buf = await downloadPlain(url);
    return saveTempMedia(buf, ext);
  } catch (err) {
    logError(`fetchPlainUrl: download failed url=${url} ext=${ext} err=${String(err)}`);
    return undefined;
  }
}

// ── Item parsers ───────────────────────────────────────────────────────────

async function parseTextItem(item: MessageItem): Promise<Partial<InboundMsg>> {
  return { text: item.text_item?.text ?? "" };
}

async function parseVoiceItem(item: MessageItem): Promise<Partial<InboundMsg>> {
  // Prefer voice-to-text transcript if available.
  const transcript = item.voice_item?.text;
  if (transcript) {
    return { text: transcript };
  }
  return { text: "[语音]" };
}

async function parseImageItem(
  item: MessageItem,
  cdnBaseUrl: string
): Promise<Partial<InboundMsg>> {
  const imageItem = item.image_item;
  if (!imageItem) return { text: "[图片]" };

  const media = imageItem.media;
  const aesKey = imageItem.aeskey ?? media?.aes_key;

  // Encrypted CDN image
  if (media?.encrypt_query_param && aesKey) {
    const imagePath = await fetchEncryptedMedia(
      media.encrypt_query_param,
      aesKey,
      "jpg",
      cdnBaseUrl
    );
    if (imagePath) {
      log(`parseImageItem: saved encrypted image to ${imagePath}`);
      return { text: "[图片]", imagePath };
    }
    return { text: "[图片(下载失败)]" };
  }

  // Plain URL fallback (cdn_url or url)
  const url = imageItem.cdn_url ?? imageItem.url;
  if (url) {
    const imagePath = await fetchPlainUrl(url, "jpg");
    if (imagePath) {
      log(`parseImageItem: saved plain image to ${imagePath}`);
      return { text: "[图片]", imagePath };
    }
    return { text: "[图片(下载失败)]" };
  }

  return { text: "[图片]" };
}

async function parseFileItem(
  item: MessageItem,
  cdnBaseUrl: string
): Promise<Partial<InboundMsg>> {
  const fileItem = item.file_item;
  if (!fileItem) return { text: "[文件]" };

  const media = fileItem.media;
  const fileName = fileItem.file_name;
  const ext = extFromFileName(fileName, "bin");

  if (media?.encrypt_query_param && media.aes_key) {
    const filePath = await fetchEncryptedMedia(
      media.encrypt_query_param,
      media.aes_key,
      ext,
      cdnBaseUrl
    );
    if (filePath) {
      log(`parseFileItem: saved encrypted file to ${filePath}`);
      return { text: `[文件: ${fileName ?? "file"}]`, filePath, fileName: fileName ?? "file" };
    }
    return { text: `[文件: ${fileName ?? "file"}(下载失败)]` };
  }

  return { text: `[文件: ${fileName ?? "file"}]` };
}

async function parseVideoItem(
  item: MessageItem,
  cdnBaseUrl: string
): Promise<Partial<InboundMsg>> {
  const videoItem = item.video_item;
  if (!videoItem) return { text: "[视频]" };

  const media = videoItem.media;

  if (media?.encrypt_query_param && media.aes_key) {
    const videoPath = await fetchEncryptedMedia(
      media.encrypt_query_param,
      media.aes_key,
      "mp4",
      cdnBaseUrl
    );
    if (videoPath) {
      log(`parseVideoItem: saved encrypted video to ${videoPath}`);
      return { text: "[视频]", videoPath };
    }
    return { text: "[视频(下载失败)]" };
  }

  return { text: "[视频]" };
}

// ── Main parse function ────────────────────────────────────────────────────

/**
 * Parse a WeixinRawMessage from getUpdates into a structured InboundMsg.
 *
 * Handles the first recognized item in item_list:
 *   type=1 (TEXT)  → extracts text
 *   type=2 (IMAGE) → downloads+decrypts to temp file, sets imagePath
 *   type=3 (VOICE) → uses voice-to-text transcript if present, else "[语音]"
 *   type=4 (FILE)  → downloads+decrypts to temp file, sets filePath + fileName
 *   type=5 (VIDEO) → downloads+decrypts to temp file, sets videoPath
 *
 * Also sets senderId and contextToken from the raw message envelope.
 *
 * @param msg        Raw message from getUpdates
 * @param cdnBaseUrl CDN base URL (defaults to CDN_BASE_URL from config)
 */
export async function parseMessage(
  msg: WeixinRawMessage,
  cdnBaseUrl: string = CDN_BASE_URL
): Promise<InboundMsg> {
  const senderId = msg.from_user_id ?? "";
  const contextToken = msg.context_token;

  let partial: Partial<InboundMsg> = { text: "" };

  const items = msg.item_list ?? [];
  for (const item of items) {
    const type = item.type;
    if (type === MSG_ITEM_TEXT) {
      partial = await parseTextItem(item);
      break;
    } else if (type === MSG_ITEM_IMAGE) {
      partial = await parseImageItem(item, cdnBaseUrl);
      break;
    } else if (type === MSG_ITEM_VOICE) {
      partial = await parseVoiceItem(item);
      break;
    } else if (type === MSG_ITEM_FILE) {
      partial = await parseFileItem(item, cdnBaseUrl);
      break;
    } else if (type === MSG_ITEM_VIDEO) {
      partial = await parseVideoItem(item, cdnBaseUrl);
      break;
    }
  }

  return {
    text: partial.text ?? "",
    imagePath: partial.imagePath,
    filePath: partial.filePath,
    fileName: partial.fileName,
    videoPath: partial.videoPath,
    senderId,
    contextToken,
  };
}
