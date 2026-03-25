/**
 * AES-128-ECB crypto utilities for Weixin CDN upload/download.
 * Extracted from /tmp/package/src/cdn/aes-ecb.ts and pic-decrypt.ts.
 */

import { createCipheriv, createDecipheriv } from "node:crypto";

/** Encrypt buffer with AES-128-ECB (PKCS7 padding). */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** Decrypt buffer with AES-128-ECB (PKCS7 padding). */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Compute AES-128-ECB ciphertext size (PKCS7 padding to 16-byte boundary). */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

/**
 * Parse a CDNMedia.aes_key (base64-encoded) into a raw 16-byte AES key.
 *
 * Two encodings are seen in the wild:
 *   - base64(raw 16 bytes)           — images (aes_key from media field)
 *   - base64(hex string of 16 bytes) — file / voice / video
 *
 * In the second case, base64-decoding yields 32 ASCII hex chars which must
 * then be parsed as hex to recover the actual 16-byte key.
 */
export function parseAesKey(raw: string): Buffer {
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(
    `parseAesKey: must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes (input="${raw}")`
  );
}
