/**
 * 腾讯云流式语音合成（TTS WebSocket）测试
 *
 * 核心概念：
 * - 不走 REST API，而是通过 WebSocket 调用 TextToStreamAudioWSv2 接口
 * - 客户端分段发送文本，服务端边合成边回传音频分片，实现低延迟流式合成
 * - 通过 HMAC-SHA1 生成请求签名，拼接成 wss 连接地址
 *
 * 代码逻辑：
 * 1. 从环境变量读取 SecretId / SecretKey / AppId
 * 2. 按参数名排序生成签名串，拼接 WebSocket URL
 * 3. 建立连接，等服务端就绪（ready === 1）后分段发送文本
 * 4. 将收到的二进制音频分片写入本地文件，收到 final 后结束
 *
 * 数据流向：分段文本 → WebSocket → 音频分片 → 本地 mp3 文件
 *
 * @see tts-test.mjs — 非流式合成方案，一次性返回完整音频
 * @see asr-test.mjs — 语音识别方案，可将本文件产物回转为文本
 */
import "dotenv/config";
import WebSocket from "ws";
import crypto from "node:crypto";
import fs from "node:fs";

const SECRET_ID = process.env.SECRET_ID; // 腾讯云 API 密钥 ID（.env 中配置）
const SECRET_KEY = process.env.SECRET_KEY; // 腾讯云 API 密钥 Key（.env 中配置）
const APP_ID = process.env.APP_ID; // 腾讯云应用 ID（.env 中配置）

const VOICE_TYPE = 101001; // 音色 ID（101001：智瑜，女声）
const OUTPUT_FILE = "output3.mp3"; // 合成音频输出路径
const TEXT_INTERVAL_MS = 3000; // 分段文本发送间隔（毫秒），模拟边说话边合成
const TEXTS = [ // 按句切分的文本片段，逐段流式发送
  "傍晚我还在为晚霞开心，",
  "突然接到电话说系统崩了，",
  "我心里一沉冲回办公室，",
  "好在大家一起排查后终于恢复，",
  "我长长松了口气。",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); // 延时工具，控制文本发送节奏

/**
 * 构造带签名的 WebSocket 连接地址
 * @returns {{ sessionId: string, url: string }} 会话 ID 与 wss 地址
 */
function buildWsUrl() {
  const now = Math.floor(Date.now() / 1000); // 当前时间戳（秒），用于签名与有效期
  const sessionId = `session_${now}_${Math.random().toString(36).slice(2)}`; // 随机会话 ID

  const params = {
    Action: "TextToStreamAudioWSv2", // 接口名：流式合成 v2
    AppId: parseInt(APP_ID), // 应用 ID
    Codec: "mp3", // 输出音频编码格式
    Expired: now + 3600, // 签名有效期（1 小时后过期）
    SampleRate: 16000, // 采样率
    SecretId: SECRET_ID, // API 密钥 ID
    SessionId: sessionId, // 会话 ID
    Speed: 0, // 语速（0 为默认）
    Timestamp: now, // 签名时间戳
    VoiceType: VOICE_TYPE, // 音色 ID
    Volume: 5, // 音量（0-10）
  };

  // 签名流程：参数按键名排序 → 拼接 key=value → 拼上方法与域名 → HMAC-SHA1 → Base64
  const sortedKeys = Object.keys(params).sort(); // 1. 按参数名升序排序
  const signStr = sortedKeys.map((k) => `${k}=${params[k]}`).join("&"); // 2. 拼接成 key=value&... 形式
  const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`; // 3. 拼接签名原文
  const signature = crypto // 4. 生成 HMAC-SHA1 签名
    .createHmac("sha1", SECRET_KEY)
    .update(rawStr)
    .digest("base64");
  const searchParams = new URLSearchParams({ // 5. 将参数与签名编码为查询串
    ...params,
    Signature: signature,
  });

  return {
    sessionId, // 会话 ID，后续发送文本时需携带
    url: `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`, // 完整 wss 地址
  };
}

/**
 * 分段发送待合成文本
 * @param {WebSocket} ws - 已建立的 WebSocket 连接
 * @param {string} sessionId - 会话 ID，与服务端约定关联
 */
async function sendTexts(ws, sessionId) {
  for (let i = 0; i < TEXTS.length; i++) {
    // 逐段发送合成指令，携带会话 ID、消息 ID 与文本内容
    ws.send(JSON.stringify({ session_id: sessionId, message_id: `msg_${i}`, action: "ACTION_SYNTHESIS", data: TEXTS[i] }));
    console.log(`[文本] 已发送: ${TEXTS[i]}`);
    if (i < TEXTS.length - 1) await sleep(TEXT_INTERVAL_MS); // 段间等待，模拟流式输入
  }
  // 全部文本发送完毕后，通知服务端结束
  ws.send(JSON.stringify({ session_id: sessionId, action: "ACTION_COMPLETE" }));
  console.log("[文本] 已发送 ACTION_COMPLETE");
}

function streamTTS() {
  if (!SECRET_ID || !SECRET_KEY || !APP_ID) {
    throw new Error("请先在 .env 配置 SECRET_ID、SECRET_KEY、APP_ID");
  }

  const { url, sessionId } = buildWsUrl(); // 获取签名地址与会话 ID
  const ws = new WebSocket(url); // 建立 WebSocket 连接
  const writeStream = fs.createWriteStream(OUTPUT_FILE, { flags: "w" }); // 音频写入流（覆盖写）
  let totalBytes = 0; // 已接收音频字节数
  let closed = false; // 是否已收尾，防止重复关闭
  let sent = false; // 是否已开始发送文本

  const closeAll = () => { // 统一收尾：结束写流并关闭连接
    if (closed) return;
    closed = true;
    writeStream.end(() => {
      console.log(`[保存] 音频已保存至 ${OUTPUT_FILE}，共 ${totalBytes} 字节`);
    });
    if (ws.readyState < WebSocket.CLOSING) ws.close();
  };

  ws.on("open", () => { // 连接建立，等待服务端 ready 就绪
    console.log("[连接] WebSocket 已建立，等待服务端就绪...");
  });

  ws.on("message", async (data, isBinary) => {
    if (isBinary) { // 二进制消息为音频分片，直接写入文件
      writeStream.write(data);
      totalBytes += data.length;
      return;
    }

    try {
      const msg = JSON.parse(data.toString()); // 文本消息为 JSON 控制信息
      console.log("[消息]", JSON.stringify(msg));

      if (msg.ready === 1 && !sent) { // 服务端就绪且尚未发送过文本
        sent = true;
        await sendTexts(ws, sessionId);
      }

      if (msg.code && msg.code !== 0) { // 服务端返回错误码
        console.error(`[错误] code=${msg.code}, message=${msg.message}`);
        closeAll();
      } else if (msg.final === 1) { // 服务端通知合成结束
        console.log("[完成] 合成结束。");
        closeAll();
      }
    } catch (e) {
      console.error("[解析错误]", e.message);
    }
  });

  ws.on("error", (err) => { // 连接异常
    console.error("[WebSocket 错误]", err.message);
    closeAll();
  });

  ws.on("close", (code, reason) => { // 连接关闭
    console.log(`[断开] 连接已关闭，code=${code}, reason=${reason}`);
    closeAll();
  });
}

streamTTS();