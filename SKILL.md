---
name: capy-wechat
description: >
  Connect Capy to WeChat so the user can chat with AI directly inside WeChat.
  Full media support: text, voice, images, files, and video — all encrypted via AES-128-ECB.
  Use this skill whenever the user wants to integrate WeChat with Capy or AI,
  asks how to use AI in WeChat, says "把微信和Capy连接", "微信接入AI",
  "WeChat bot", "微信机器人", "在微信里用AI", or invokes /capy-wechat.
  Also trigger when the user wants to restart, check status, or stop the WeChat service.
---

# Capy WeChat — Full-Featured WeChat AI Bot

Personal WeChat AI bot powered by Capy's AI Gateway, with full media support.
Based on the official WeChat ClawBot iLink API.

**Capabilities:**
- Text, voice, image, file, video — send and receive
- AES-128-ECB encrypted CDN media (decode + encode)
- Typing indicator ("对方正在输入...")
- Long message auto-splitting (smart break at paragraphs/sentences)
- Persona injection (loads SOUL.md + IDENTITY.md from agent files)
- Dual mode: casual chat + work mode (with full agent tools)
- Access control via allowFrom.json whitelist
- context_token disk persistence (survives restarts)
- Session -14 expiry handling (auto-pause + recovery)

**Requirements:**
- iOS/Android WeChat (latest version) — needed for QR scan
- `AI_GATEWAY_API_KEY` environment variable — already set in the Capy sandbox

---

## Architecture

```
WeChat user sends message
      |
WeChat ClawBot iLink API (long-poll)
      |
capy-wechat service (src/main.ts)
  |-- poll.ts          (long-poll loop + sync_buf persistence)
  |-- router.ts        (mode switch + allowlist + persona injection)
  |-- messaging/
  |     |-- parse.ts   (decode all message types, decrypt media)
  |     |-- send.ts    (send text/image/file/video, auto-split)
  |     +-- context-store.ts (context_token persistence)
  |-- cdn/
  |     |-- aes.ts     (AES-128-ECB encrypt/decrypt)
  |     |-- download.ts (CDN download + decrypt)
  |     +-- upload.ts   (encrypt + CDN upload)
  |-- ilink/
  |     |-- api.ts     (all iLink API calls)
  |     +-- typing.ts  (typing indicator)
  |-- backends/
  |     |-- casual.ts  (AI Gateway chat)
  |     +-- work.ts    (claude -p agent)
  +-- session.ts       (errcode -14 handling)
```

---

## Step 1 — Install the service files

Check if `capy-wechat/` already exists in the workspace with `src/main.ts`. If not, set it up:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version 2>/dev/null || curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

WORKSPACE=$(pwd)
```

If `capy-wechat/src/main.ts` does NOT exist, clone from GitHub:

```bash
cd "$WORKSPACE"
git clone https://github.com/MatteoCui001/capy-wechat.git capy-wechat
cd capy-wechat && bun install
```

If `capy-wechat/` already exists but only has the legacy `service.ts` (no `src/` directory),
the agent should pull the latest version:

```bash
cd "$WORKSPACE/capy-wechat"
git pull origin main
bun install
```

---

## Step 2 — Authenticate (first time only)

If `~/.capy/wechat/account.json` already exists, skip to Step 3.

Run setup in the background (it auto-refreshes the QR code every ~35 seconds
until the user scans it):

```bash
cd capy-wechat
export PATH="$HOME/.bun/bin:$PATH"
bun setup.ts > /tmp/wechat-setup.log 2>&1 &
echo "Setup PID: $!"
```

Wait ~3 seconds, then read the QR code image:
- QR is saved to `outputs/wechat-qr.png` in the workspace
- Use the `Read` tool to display it inline so the user can scan it
- Tell the user: "Please scan this with WeChat → + → Scan, then tap Confirm"
- Keep polling `/tmp/wechat-setup.log` every few seconds to detect confirmation
- When log shows "微信连接成功", authentication is complete

```bash
tail -20 /tmp/wechat-setup.log
```

---

## Step 3 — Start the service

```bash
cd capy-wechat
export PATH="$HOME/.bun/bin:$PATH"
AI_GATEWAY_API_KEY="$AI_GATEWAY_API_KEY" bun src/main.ts > /tmp/wechat-service.log 2>&1 &
echo "Service PID: $!"
sleep 3
tail -5 /tmp/wechat-service.log
```

A healthy start looks like:
```
[HH:MM:SS] 账号加载成功: <bot-id>
[HH:MM:SS] context tokens 已恢复
[HH:MM:SS] 服务启动，账号: <bot-id>
[HH:MM:SS] 开始监听微信消息...
```

Tell the user: "WeChat is now connected. Send a message in WeChat and Capy will reply."

---

## Checking service status

```bash
tail -20 /tmp/wechat-service.log
ps aux | grep "bun src/main.ts" | grep -v grep
```

---

## Stopping the service

```bash
pkill -f "bun src/main.ts"
echo "Service stopped"
```

---

## Restarting the service

```bash
pkill -f "bun src/main.ts"
sleep 2
cd capy-wechat
export PATH="$HOME/.bun/bin:$PATH"
AI_GATEWAY_API_KEY="$AI_GATEWAY_API_KEY" bun src/main.ts > /tmp/wechat-service.log 2>&1 &
sleep 3
tail -5 /tmp/wechat-service.log
```

---

## Re-authenticating (if token expires)

Tokens are long-lived but may expire. If service logs show auth errors or errcode -14:

```bash
rm ~/.capy/wechat/account.json
# Then repeat Step 2
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | (from sandbox) | AI Gateway authentication |
| `AI_GATEWAY_URL` | No | `https://ai-gateway.happycapy.ai/api/v1/chat/completions` | AI endpoint |
| `AI_MODEL` | No | `anthropic/claude-sonnet-4.6` | Model for casual chat |
| `WEB_MODEL` | No | `perplexity/sonar` | Model for web searches |
| `WORKSPACE_DIR` | No | `(auto-detected)` | Working directory for work mode |

---

## User commands (in WeChat)

| Command | Effect |
|---------|--------|
| `干活` / `工作` / `开工` | Switch to work mode (full agent tools) |
| `休闲` / `聊天` / `放松` | Switch back to casual chat mode |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| QR expired | Scanned too slowly | QR auto-refreshes; scan the new one |
| No reply in WeChat | Service not started | Check `/tmp/wechat-service.log` |
| "AI_GATEWAY_API_KEY not set" | Env var missing | Restart session; key is auto-set |
| Auth errors after days | Token expired | Delete account.json, re-authenticate |
| "[图片]" but no content | Legacy version running | Ensure using `bun src/main.ts` not `bun service.ts` |

---

## Notes for the agent

- Entry point is `bun src/main.ts` (NOT `bun service.ts` which is legacy)
- The service loads persona from `~/.happycapy/agents/capy-default/SOUL.md` and `IDENTITY.md`
- context_token persists to `~/.capy/wechat/context-tokens.json` — no message loss on restart
- Media temp files go to `/tmp/capy-wechat/` — cleaned up automatically
- `import.meta.dir` in setup.ts resolves QR output to `workspace/outputs/wechat-qr.png`
- Use `Read` tool to display QR image inline; do not ask user to open a file path
- If both legacy `service.ts` and new `src/main.ts` processes exist, kill legacy first
