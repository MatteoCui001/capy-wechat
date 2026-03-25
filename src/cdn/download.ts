/**
 * CDN download + AES-128-ECB decryption for Weixin media files.
 * Reference: /tmp/package/src/cdn/pic-decrypt.ts
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseAesKey, decryptAesEcb } from "./aes.ts";
import { log, logError } from "../config.ts";

// ── Temp directory ─────────────────────────────────────────────────────────

export const TEMP_MEDIA_DIR = "/tmp/capy-wechat";

// Ensure temp directory exists at module load time.
fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });

// ── Core download helpers ──────────────────────────────────────────────────

/**
 * Build the CDN download URL from a base URL and encrypted_query_param.
 */
function buildCdnDownloadUrl(cdnBaseUrl: string, encryptedQueryParam: string): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/**
 * Fetch raw bytes from a CDN URL. Throws on non-OK response.
 */
async function fetchCdnBytes(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    logError(`CDN fetch error url=${url} err=${String(err)}`);
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    const msg = `CDN download ${res.status} ${res.statusText} body=${body}`;
    logError(msg);
    throw new Error(msg);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Download and AES-128-ECB decrypt a CDN media file.
 *
 * @param cdnBaseUrl          CDN base URL (default: CDN_BASE_URL from config)
 * @param encryptQueryParam   CDNMedia.encrypt_query_param value
 * @param aesKeyRaw           CDNMedia.aes_key value (base64-encoded; see parseAesKey)
 * @returns                   Plaintext Buffer
 */
export async function downloadAndDecrypt(
  cdnBaseUrl: string,
  encryptQueryParam: string,
  aesKeyRaw: string
): Promise<Buffer> {
  const key = parseAesKey(aesKeyRaw);
  const url = buildCdnDownloadUrl(cdnBaseUrl, encryptQueryParam);
  log(`CDN download url=${url.slice(0, 80)}...`);
  const encrypted = await fetchCdnBytes(url);
  log(`CDN downloaded ${encrypted.byteLength} bytes, decrypting`);
  const decrypted = decryptAesEcb(encrypted, key);
  log(`CDN decrypted ${decrypted.length} bytes`);
  return decrypted;
}

/**
 * Download a plain (unencrypted) file from a URL. Returns the raw Buffer.
 */
export async function downloadPlain(url: string): Promise<Buffer> {
  return fetchCdnBytes(url);
}

/**
 * Save a Buffer to /tmp/capy-wechat/<random>.<ext> and return the full path.
 *
 * @param buffer  File content to write
 * @param ext     File extension without leading dot (e.g. "jpg", "mp4")
 */
export function saveTempMedia(buffer: Buffer, ext: string): string {
  const name = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const filePath = path.join(TEMP_MEDIA_DIR, name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}
