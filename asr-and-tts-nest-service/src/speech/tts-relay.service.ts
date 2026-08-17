/**
 * TTS 中继服务（AI 流式文本 → 腾讯云流式合成）
 *
 * 核心概念：
 * - 同时管理「浏览器客户端 WebSocket」与「腾讯云 TTS WebSocket」两个连接
 * - 监听 AI_TTS_STREAM_EVENT，将 AI 流式文本分片转发给腾讯云合成
 * - 腾讯云回传的二进制音频分片实时转发回浏览器客户端播放
 *
 * 代码逻辑：
 * 1. registerClient 注册浏览器客户端会话（按 sessionId）
 * 2. handleAiStreamEvent 响应 start/chunk/end/error 四类事件
 * 3. start 时惰性建立腾讯云 WebSocket 连接
 * 4. 连接未就绪前缓存分片，ready 后统一 flush
 * 5. 二进制音频分片逐包转发给客户端
 *
 * 数据流向：AI 事件 → 腾讯云 TTS WebSocket → 音频分片 → 浏览器客户端
 *
 * @see common/stream-events.ts — 事件类型定义
 * @see ai/ai.service.ts — 事件的生产者（AI 流式输出）
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from '../common/stream-events';
import WebSocket from 'ws';

type ClientSession = {
  sessionId: string; // 会话 ID
  clientWs: WebSocket; // 浏览器客户端连接
  tencentWs?: WebSocket; // 腾讯云 TTS 连接（惰性建立）
  ready: boolean; // 腾讯云是否就绪（ready === 1）
  pendingChunks: string[]; // 就绪前缓存的文本分片
  closed: boolean; // 会话是否已关闭
};

@Injectable()
export class TtsRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(TtsRelayService.name);
  private readonly sessions = new Map<string, ClientSession>(); // 会话表：sessionId → 会话
  private readonly secretId: string; // TTS 凭证 SecretId
  private readonly secretKey: string; // TTS 凭证 SecretKey
  private readonly appId: number; // 腾讯云应用 ID
  private readonly voiceType: number; // 合成音色 ID

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.secretId = configService.get<string>('SECRET_ID') ?? ''; // 读取密钥 ID
    this.secretKey = configService.get<string>('SECRET_KEY') ?? ''; // 读取密钥 Key
    this.appId = Number(configService.get<string>('APP_ID') ?? 0); // 读取应用 ID
    this.voiceType = Number(configService.get<string>('TTS_VOICE_TYPE') ?? 101001); // 音色，默认智瑜
  }

  onModuleDestroy(): void {
    for (const session of this.sessions.values()) { // 应用销毁时关闭所有会话
      this.closeSession(session.sessionId, 'module destroy');
    }
  }

  registerClient(clientWs: WebSocket, wantedSessionId?: string): string {
    const sessionId = wantedSessionId?.trim() || randomUUID(); // 复用指定 ID，否则随机生成
    const existing = this.sessions.get(sessionId);
    if (existing) { // 相同 sessionId 重连时先关闭旧会话
      this.closeSession(sessionId, 'client reconnected');
    }

    this.sessions.set(sessionId, {
      sessionId,
      clientWs,
      ready: false, // 初始未就绪
      pendingChunks: [], // 初始无缓存分片
      closed: false,
    });
    this.sendClientJson(clientWs, { type: 'session', sessionId }); // 回传会话 ID 给客户端
    this.logger.log(`TTS client connected: ${sessionId}`);
    return sessionId;
  }

  unregisterClient(sessionId: string): void {
    this.closeSession(sessionId, 'client disconnected'); // 客户端断开时注销会话
  }

  @OnEvent(AI_TTS_STREAM_EVENT)
  handleAiStreamEvent(event: AiTtsStreamEvent): void {
    const session = this.sessions.get(event.sessionId);
    if (!session) return; // 无对应会话则忽略

    switch (event.type) {
      case 'start': { // AI 开始：建立腾讯云连接并通知客户端
        this.ensureTencentConnection(session);
        this.sendClientJson(session.clientWs, {
          type: 'tts_started',
          sessionId: session.sessionId,
          query: event.query,
        });
        break;
      }
      case 'chunk': { // AI 分片：就绪则转发，否则缓存
        const chunk = event.chunk?.trim();
        if (!chunk) return;
        if (!session.ready || !session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
          session.pendingChunks.push(chunk); // 未就绪，暂存分片
          return;
        }
        this.sendTencentChunk(session, chunk);
        break;
      }
      case 'end': { // AI 结束：清空缓存并发送完成指令
        this.flushPendingChunks(session);
        if (session.tencentWs && session.tencentWs.readyState === WebSocket.OPEN) {
          session.tencentWs.send(
            JSON.stringify({
              session_id: session.sessionId,
              action: 'ACTION_COMPLETE', // 通知腾讯云合成结束
            }),
          );
        }
        break;
      }
      case 'error': { // AI 异常：通知客户端并关闭会话
        this.sendClientJson(session.clientWs, {
          type: 'tts_error',
          message: event.error,
        });
        this.closeSession(session.sessionId, 'ai stream error');
        break;
      }
    }
  }

  private ensureTencentConnection(session: ClientSession): void {
    if (session.tencentWs && session.tencentWs.readyState <= WebSocket.OPEN) {
      return; // 已有可用连接则复用
    }
    if (!this.secretId || !this.secretKey || !this.appId) { // 凭证缺失时直接报错
      this.sendClientJson(session.clientWs, {
        type: 'tts_error',
        message: 'TTS 凭证缺失，请检查 SECRET_ID/SECRET_KEY/APP_ID',
      });
      return;
    }

    const url = this.buildTencentTtsWsUrl(session.sessionId); // 生成带签名的 wss 地址
    const tencentWs = new WebSocket(url); // 建立腾讯云 TTS 连接
    session.tencentWs = tencentWs;
    session.ready = false;

    tencentWs.on('open', () => { // 连接建立
      this.logger.log(`Tencent TTS ws opened: ${session.sessionId}`);
    });

    tencentWs.on('message', (data, isBinary) => {
      if (session.closed) return;
      if (isBinary) { // 二进制消息为音频分片，直接转发给浏览器客户端
        if (session.clientWs.readyState === WebSocket.OPEN) {
          session.clientWs.send(data, { binary: true });
        }
        return;
      }

      const raw = data.toString();
      let msg: Record<string, unknown> | undefined;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>; // 文本消息为 JSON 控制信息
      } catch {
        return;
      }

      if (Number(msg.ready) === 1) { // 腾讯云就绪，置位并清空缓存
        session.ready = true;
        this.flushPendingChunks(session);
      }

      if (Number(msg.code) && Number(msg.code) !== 0) { // 返回错误码
        this.sendClientJson(session.clientWs, {
          type: 'tts_error',
          message: String(msg.message ?? 'Tencent TTS error'),
          code: Number(msg.code),
        });
        this.closeSession(session.sessionId, 'tencent error');
        return;
      }

      if (Number(msg.final) === 1) { // 合成完成
        this.sendClientJson(session.clientWs, { type: 'tts_final' });
      }
    });

    tencentWs.on('error', (error) => { // 腾讯云连接异常
      this.sendClientJson(session.clientWs, {
        type: 'tts_error',
        message: `Tencent ws error: ${error.message}`,
      });
    });

    tencentWs.on('close', () => { // 腾讯云连接关闭，清理状态
      session.tencentWs = undefined;
      session.ready = false;
    });
  }

  private flushPendingChunks(session: ClientSession): void {
    if (!session.ready || !session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
      return; // 未就绪或连接不可用则不清空
    }
    while (session.pendingChunks.length > 0) { // 按序清空缓存分片
      const chunk = session.pendingChunks.shift();
      if (!chunk) continue;
      this.sendTencentChunk(session, chunk);
    }
  }

  private sendTencentChunk(session: ClientSession, text: string): void {
    if (!session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
      session.pendingChunks.push(text); // 连接不可用时回退缓存
      return;
    }

    session.tencentWs.send(
      JSON.stringify({
        session_id: session.sessionId,
        message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, // 唯一消息 ID
        action: 'ACTION_SYNTHESIS', // 合成动作
        data: text, // 待合成文本
      }),
    );
  }

  private closeSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closed = true;

    if (session.tencentWs && session.tencentWs.readyState < WebSocket.CLOSING) {
      session.tencentWs.close(); // 关闭腾讯云连接
    }
    if (session.clientWs.readyState < WebSocket.CLOSING) {
      this.sendClientJson(session.clientWs, { type: 'tts_closed', reason }); // 通知客户端关闭
      session.clientWs.close();
    }
    this.sessions.delete(sessionId); // 移除会话
    this.logger.log(`TTS session closed: ${sessionId}, reason: ${reason}`);
  }

  private sendClientJson(clientWs: WebSocket, payload: Record<string, unknown>): void {
    if (clientWs.readyState !== WebSocket.OPEN) return; // 连接非 OPEN 时跳过
    clientWs.send(JSON.stringify(payload));
  }

  private buildTencentTtsWsUrl(sessionId: string): string {
    const now = Math.floor(Date.now() / 1000); // 当前时间戳（秒）
    const params: Record<string, string | number> = {
      Action: 'TextToStreamAudioWSv2', // 接口名：流式合成 v2
      AppId: this.appId, // 应用 ID
      Codec: 'mp3', // 输出音频编码格式
      Expired: now + 3600, // 签名有效期（1 小时后过期）
      SampleRate: 16000, // 采样率
      SecretId: this.secretId, // 密钥 ID
      SessionId: sessionId, // 会话 ID
      Speed: 0, // 语速（0 为默认）
      Timestamp: now, // 签名时间戳
      VoiceType: this.voiceType, // 音色 ID
      Volume: 5, // 音量（0-10）
    };

    // 签名流程：参数按键名排序 → 拼接 key=value → 拼上方法与域名 → HMAC-SHA1 → Base64
    const signStr = Object.keys(params)
      .sort() // 1. 按参数名升序排序
      .map((k) => `${k}=${params[k]}`) // 2. 拼接成 key=value 形式
      .join('&'); // 3. 以 & 连接
    const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`; // 4. 拼接签名原文
    const signature = createHmac('sha1', this.secretKey).update(rawStr).digest('base64'); // 5. 生成签名
    const searchParams = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), // 参数值统一转字符串
      Signature: signature, // 附加签名
    });

    return `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`;
  }
}
