/**
 * Shared types and constants for capy-wechat.
 * Mirrors the ilink protocol types from the official SDK.
 */

// ── Message type constants ─────────────────────────────────────────────────

export const MSG_TYPE_USER = 1;
export const MSG_TYPE_BOT = 2;

export const MSG_ITEM_TEXT = 1;
export const MSG_ITEM_IMAGE = 2;
export const MSG_ITEM_VOICE = 3;
export const MSG_ITEM_FILE = 4;
export const MSG_ITEM_VIDEO = 5;

export const MSG_STATE_FINISH = 2;

// ── CDN media reference ────────────────────────────────────────────────────

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

// ── Message item sub-types ─────────────────────────────────────────────────

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  /** Raw AES-128 key as hex string (16 bytes) */
  aeskey?: string;
  /** Fallback plain URL (not encrypted) */
  url?: string;
  cdn_url?: string;
  thumb_url?: string;
  mid_size?: number;
  hd_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  /** Voice-to-text transcript */
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface TextItem {
  text?: string;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

// ── Raw inbound message from getUpdates ───────────────────────────────────

export interface WeixinRawMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

// ── API response types ─────────────────────────────────────────────────────

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinRawMessage[];
  get_updates_buf?: string;
  sync_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface UploadedMedia {
  filekey: string;
  /** CDN download encrypted_query_param */
  downloadEncryptedQueryParam: string;
  /** AES-128-ECB key, hex-encoded */
  aeskey: string;
  /** Plaintext file size in bytes */
  fileSize: number;
  /** Ciphertext file size in bytes (AES-128-ECB with PKCS7 padding) */
  fileSizeCiphertext: number;
}

// ── Credentials / options ──────────────────────────────────────────────────

export interface Account {
  token: string;
  baseUrl: string;
  accountId: string;
  userId?: string;
  savedAt: string;
}

export interface WeixinOpts {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  longPollTimeoutMs?: number;
}

// ── Inbound parsed message ─────────────────────────────────────────────────

export interface InboundMsg {
  text: string;
  imageBase64?: string;
  imageMime?: string;
  /** Local path to decrypted/downloaded image file */
  imagePath?: string;
  /** Local path to decrypted file attachment */
  filePath?: string;
  /** Original filename for file attachments */
  fileName?: string;
  /** Local path to decrypted video file */
  videoPath?: string;
  /** Sender's user ID */
  senderId?: string;
  /** Context token to echo back in replies */
  contextToken?: string;
}

// ── AI chat types ──────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}
