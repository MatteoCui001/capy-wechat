/**
 * CDN upload: AES-128-ECB encrypt + getUploadUrl + HTTP POST.
 * Reference: /tmp/package/src/cdn/upload.ts and /tmp/package/src/cdn/cdn-upload.ts
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { WeixinOpts, UploadedMedia } from "../types.ts";
import { MSG_ITEM_IMAGE, MSG_ITEM_FILE, MSG_ITEM_VIDEO } from "../types.ts";
import { getUploadUrl } from "../ilink/api.ts";
import { encryptAesEcb, aesEcbPaddedSize } from "./aes.ts";
import { CDN_BASE_URL, UPLOAD_TIMEOUT_MS, log, logError } from "../config.ts";

// ── Internal CDN upload ─────────────────────────────────────────────────────

const UPLOAD_MAX_RETRIES = 3;

/**
 * Build the CDN upload URL.
 */
function buildCdnUploadUrl(cdnBaseUrl: string, uploadParam: string, filekey: string): string {
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

/**
 * Encrypt buf with AES-128-ECB and POST to CDN upload URL.
 * Returns the download encrypted_query_param from the x-encrypted-param response header.
 * Retries up to UPLOAD_MAX_RETRIES times on server errors.
 */
async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadParam: string;
  filekey: string;
  cdnBaseUrl: string;
  aeskey: Buffer;
}): Promise<string> {
  const { buf, uploadParam, filekey, cdnBaseUrl, aeskey } = params;
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = buildCdnUploadUrl(cdnBaseUrl, uploadParam, filekey);

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(cdnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(ciphertext),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get("x-error-message") ?? (await res.text());
        logError(`CDN upload client error attempt=${attempt} status=${res.status} errMsg=${errMsg}`);
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }

      if (res.status !== 200) {
        const errMsg = res.headers.get("x-error-message") ?? `status ${res.status}`;
        logError(`CDN upload server error attempt=${attempt} status=${res.status} errMsg=${errMsg}`);
        throw new Error(`CDN upload server error: ${errMsg}`);
      }

      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        logError(`CDN response missing x-encrypted-param header attempt=${attempt}`);
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      log(`CDN upload success attempt=${attempt} filekey=${filekey}`);
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes("client error")) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        logError(`CDN upload attempt ${attempt} failed, retrying... err=${String(err)}`);
      } else {
        logError(`CDN upload all ${UPLOAD_MAX_RETRIES} attempts failed err=${String(err)}`);
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return downloadParam;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Upload a local media file to the Weixin CDN with AES-128-ECB encryption.
 *
 * Pipeline:
 *  1. Read file → compute MD5
 *  2. Generate random AES key (16 bytes) and filekey (16 bytes hex)
 *  3. Compute ciphertext size with aesEcbPaddedSize
 *  4. Call getUploadUrl
 *  5. Encrypt and POST to CDN
 *  6. Extract downloadEncryptedQueryParam from x-encrypted-param header
 *  7. Return UploadedMedia
 *
 * @param opts        WeixinOpts (baseUrl + token)
 * @param filePath    Local file path to upload
 * @param mediaType   MSG_ITEM_IMAGE (2), MSG_ITEM_FILE (4), or MSG_ITEM_VIDEO (5)
 * @param toUserId    Recipient WeChat user ID
 * @param cdnBaseUrl  CDN base URL (defaults to CDN_BASE_URL from config)
 */
export async function uploadMedia(
  opts: WeixinOpts,
  filePath: string,
  mediaType: number,
  toUserId: string,
  cdnBaseUrl: string = CDN_BASE_URL
): Promise<UploadedMedia> {
  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  log(
    `uploadMedia: filePath=${filePath} mediaType=${mediaType} rawsize=${rawsize} filesize=${filesize} md5=${rawfilemd5} filekey=${filekey}`
  );

  const uploadUrlResp = await getUploadUrl(opts, {
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadParam) {
    logError(`uploadMedia: getUploadUrl returned no upload_param resp=${JSON.stringify(uploadUrlResp)}`);
    throw new Error("uploadMedia: getUploadUrl returned no upload_param");
  }

  const downloadEncryptedQueryParam = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam,
    filekey,
    cdnBaseUrl,
    aeskey,
  });

  return {
    filekey,
    downloadEncryptedQueryParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}
