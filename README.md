# capy-wechat

WeChat AI Bot — 通过微信官方 iLink API (ClawBot) 连接微信和 AI。

基于腾讯官方微信 ClawBot iLink 协议，支持完整的媒体收发、typing indicator、多模式切换。

## 功能

- 文字聊天（claude-sonnet-4.6 驱动）
- 语音消息识别（微信转写 + AI 理解）
- 图片识别与描述（multimodal vision）
- 图片/文件/视频收发（AES-128-ECB 加解密 + CDN）
- "对方正在输入..." 原生 typing indicator
- 干活模式（调用 Claude Code 执行真实任务）
- Web 搜索（自动检测需要联网的问题）
- URL 内容解析与摘要
- 长消息自动拆分（4000 字上限）
- 白名单访问控制
- context_token 磁盘持久化
- Session 管理（errcode -14 自动处理）

## 架构

```
src/
├── types.ts              # 公共类型定义
├── config.ts             # 常量、凭据、persona 加载
├── main.ts               # 入口
├── poll.ts               # 主轮询循环
├── router.ts             # 消息路由（mode 切换、白名单）
├── session.ts            # sync_buf 持久化、session 过期处理
├── ilink/
│   ├── api.ts            # iLink HTTP API 封装
│   └── typing.ts         # typing indicator
├── cdn/
│   ├── aes.ts            # AES-128-ECB 加解密
│   ├── download.ts       # CDN 下载 + 解密
│   └── upload.ts         # AES 加密 + CDN 上传
├── messaging/
│   ├── parse.ts          # 消息解析（text/image/voice/file/video）
│   ├── send.ts           # 消息发送 + 长文本拆分
│   └── context-store.ts  # context_token 持久化
└── backends/
    ├── types.ts           # AIBackend 接口
    ├── casual.ts          # 休闲聊天（AI Gateway）
    └── work.ts            # 干活模式（claude -p）
```

## 安装

```bash
# 需要 Bun runtime
curl -fsSL https://bun.sh/install | bash

# 安装依赖
bun install

# 首次认证（扫二维码）
bun setup.ts

# 启动服务
AI_GATEWAY_API_KEY=<your-key> bun src/main.ts
```

## 使用

在微信 ClawBot 对话中：

| 命令 | 说明 |
|------|------|
| 直接发消息 | 休闲聊天模式 |
| `干活` / `工作` | 切换到干活模式 |
| `休闲` / `聊天` | 切换回聊天模式 |

干活模式下可以：写代码、执行脚本、读写文件、搜索内容。

## 安全

- 凭据存储在 `~/.capy/wechat/account.json`（权限 0600）
- AI 密钥仅从环境变量读取
- 消息内容不写入日志
- 对话历史仅在内存中
- 支持白名单（`~/.capy/wechat/allowFrom.json`）

## 致谢

- 参考了 [TomCat-lab/capytowechat](https://github.com/TomCat-lab/capytowechat) 的 iLink 协议实现
- 基于腾讯官方 [@tencent-weixin/openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) API 文档

## License

MIT
