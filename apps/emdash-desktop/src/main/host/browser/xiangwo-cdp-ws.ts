// [XG-CUSTOM] 极简 RFC6455 WebSocket 服务端（零新依赖，供内嵌浏览器 CDP 桥用）。
//
// 为什么要手写：emdash 主进程没有声明任何 ws 库（`node_modules/ws` 只是构建工具的传递依赖，
// 打进产物不可靠），而 CDP 必须是 WebSocket。这里只实现 CDP 用得到的最小子集：
//   - 握手（Sec-WebSocket-Accept）
//   - 文本/二进制帧，支持分片（continuation）
//   - ping → 自动回 pong；对端 close → 回 close 并断开
// 不做扩展协商（permessage-deflate）——CDP 客户端不会要求。
//
// 安全边界：来源 IP 过滤不在这里做 —— 调用方（xiangwo-cdp-bridge.ts）缺省对外监听
// 0.0.0.0，但在**连接层**就把非本机/非组网（ZeroTier/tailscale）来源回 403 断开，
// 所以这里的握手只会收到白名单内的连接。
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 单条消息上限（CDP 快照可能很大；超过就当作异常客户端断开） */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

export type XiangwoWsConnection = {
  /** 发一条文本帧 */
  sendText(text: string): void;
  /** 主动关闭（发 close 帧） */
  close(code?: number, reason?: string): void;
  /** 收到完整消息（已解分片/已解掩码） */
  onMessage(handler: (data: Buffer, isBinary: boolean) => void): void;
  onClose(handler: () => void): void;
  readonly remoteAddress: string | undefined;
};

type ParsedFrame = { fin: boolean; opcode: number; payload: Buffer };

/** 增量帧解析器：喂字节流，吐出完整帧（调用方自己处理分片语义） */
export class XiangwoWsFrameParser {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxMessageBytes: number = MAX_MESSAGE_BYTES) {}

  push(chunk: Buffer): ParsedFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: ParsedFrame[] = [];
    for (;;) {
      const frame = this.takeFrame();
      if (frame === null) break;
      frames.push(frame);
    }
    return frames;
  }

  private takeFrame(): ParsedFrame | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0]! & 0x80) !== 0;
    const opcode = buf[0]! & 0x0f;
    const masked = (buf[1]! & 0x80) !== 0;
    let length = buf[1]! & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(this.maxMessageBytes)) {
        throw new Error(`WebSocket 帧超过上限（${this.maxMessageBytes} 字节）`);
      }
      length = Number(big);
      offset += 8;
    }
    if (length > this.maxMessageBytes) {
      throw new Error(`WebSocket 帧超过上限（${this.maxMessageBytes} 字节）`);
    }
    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + length) return null;
    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (maskKey) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] = payload[i]! ^ maskKey[i % 4]!;
      }
    }
    this.buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

/**
 * 完成握手并把 socket 包成一条连接。握手失败（没有 key / 非法请求）返回 null 并销毁 socket。
 */
export function acceptXiangwoWebSocket(
  req: IncomingMessage,
  socket: Duplex
): XiangwoWsConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || key.trim() === '') {
    socket.destroy();
    return null;
  }
  const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n')
  );

  const parser = new XiangwoWsFrameParser();
  const messageHandlers: Array<(data: Buffer, isBinary: boolean) => void> = [];
  const closeHandlers: Array<() => void> = [];
  let closed = false;
  let fragments: Buffer[] = [];
  let fragmentedOpcode: number | null = null;

  const emitClose = (): void => {
    if (closed) return;
    closed = true;
    for (const handler of closeHandlers) handler();
  };

  const finishMessage = (opcode: number, payload: Buffer): void => {
    const isBinary = opcode === OPCODE_BINARY;
    for (const handler of messageHandlers) handler(payload, isBinary);
  };

  const onData = (chunk: Buffer): void => {
    let frames: ParsedFrame[];
    try {
      frames = parser.push(chunk);
    } catch {
      socket.destroy();
      emitClose();
      return;
    }
    for (const frame of frames) {
      const { fin, opcode } = frame;
      if (opcode === OPCODE_CLOSE) {
        // 回一个 close 帧再断开（1xx 之外的最常见做法）
        socket.write(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)));
        socket.end();
        emitClose();
        return;
      }
      if (opcode === OPCODE_PING) {
        socket.write(encodeFrame(OPCODE_PONG, frame.payload));
        continue;
      }
      if (opcode === OPCODE_PONG) continue;

      if (opcode === OPCODE_CONTINUATION) {
        if (fragmentedOpcode === null) continue;
        fragments.push(frame.payload);
        if (fin) {
          const payload = Buffer.concat(fragments);
          const op = fragmentedOpcode;
          fragments = [];
          fragmentedOpcode = null;
          finishMessage(op, payload);
        }
        continue;
      }

      if (!fin) {
        fragmentedOpcode = opcode;
        fragments = [frame.payload];
        continue;
      }
      finishMessage(opcode, frame.payload);
    }
  };

  socket.on('data', onData);
  socket.on('error', () => emitClose());
  socket.on('close', () => emitClose());

  return {
    sendText(text: string): void {
      if (closed) return;
      socket.write(encodeFrame(OPCODE_TEXT, Buffer.from(text, 'utf8')));
    },
    close(code = 1000, reason = ''): void {
      if (closed) return;
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(code, 0);
      payload.write(reason, 2, 'utf8');
      socket.write(encodeFrame(OPCODE_CLOSE, payload));
      socket.end();
      emitClose();
    },
    onMessage(handler): void {
      messageHandlers.push(handler);
    },
    onClose(handler): void {
      closeHandlers.push(handler);
    },
    remoteAddress: (socket as Duplex & { remoteAddress?: string }).remoteAddress,
  };
}
