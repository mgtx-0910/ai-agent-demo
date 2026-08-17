/**
 * 应用启动入口
 *
 * 核心概念：
 * - 创建 NestJS 应用，并复用其 HTTP 服务器搭建独立的 WebSocket 服务
 * - WebSocket 路径 /speech/tts/ws 用于客户端订阅 TTS 流式音频
 * - 连接时通过 URL 的 sessionId 参数注册到 TtsRelayService，实现「AI 对话 → TTS 合成」中继
 *
 * 代码逻辑：
 * 1. NestFactory.create 创建应用
 * 2. 获取 TtsRelayService 与 HTTP 服务器，挂载 WebSocketServer
 * 3. 连接建立时解析 sessionId 并注册客户端，断开时注销
 * 4. 监听环境变量 PORT（默认 3000）
 *
 * @see speech/tts-relay.service.ts — TTS 中继服务，负责会话注册与音频转发
 * @see app.module.ts — 根模块，装配各业务模块
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WebSocketServer } from 'ws';
import { TtsRelayService } from './speech/tts-relay.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule); // 创建 Nest 应用
  const ttsRelayService = app.get(TtsRelayService); // 获取 TTS 中继服务实例
  const server = app.getHttpServer(); // 获取底层 HTTP 服务器

  const ttsWss = new WebSocketServer({ // 复用 HTTP 服务器搭建 WebSocket 服务
    server,
    path: '/speech/tts/ws', // TTS 流式音频订阅路径
  });

  ttsWss.on('connection', (socket, request) => {
    const reqUrl = new URL(request.url ?? '', 'http://localhost'); // 解析连接 URL
    const wantedSessionId = reqUrl.searchParams.get('sessionId') ?? undefined; // 读取客户端携带的会话 ID
    const sessionId = ttsRelayService.registerClient(socket, wantedSessionId); // 注册客户端会话

    socket.on('close', () => { // 客户端断开时注销会话
      ttsRelayService.unregisterClient(sessionId);
    });
  });

  await app.listen(process.env.PORT ?? 3000); // 启动 HTTP 服务（默认 3000 端口）
}
bootstrap();
