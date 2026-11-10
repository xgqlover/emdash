import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { Logger } from '@emdash/shared/logger';
import type { Controller, WireTransport } from '@emdash/wire/rpc';
import { createWireSessionHub, streamTransport } from '@emdash/wire/rpc';
import { DEFAULT_WORKSPACE_SERVER_SOCKET_PATH } from '../daemon/paths';
// [XG-CUSTOM 2026-11-05] 握手取证日志（只加日志，不改行为）
import { xgProbeTransport, xgWire, xgWireFail, xgWireFailThrottled, xgWireOk } from './xg-handshake-log';

export type SocketServeOptions = {
  socketPath?: string;
  /**
   * [XG-CUSTOM 2026-11-05] 取证日志落点。缺省 `undefined` ⇒ 走 AsyncLocalStorage 里的当前
   * logger（测试里是 noop），行为与以前一致。
   */
  logger?: Logger;
};

export type SocketServeHandle = {
  socketPath: string;
  dispose(): Promise<void>;
};

/**
 * [XG-CUSTOM 2026-11-05] 「就绪」在这台服务端**没有自己的布尔量** —— 客户端面板的
 * `Workspace Runtime: Stopped/Reconnecting` 由客户端 supervisor 判（进程在 + `health` 有回 +
 * `initialize` 通过）。服务端能给出的最接近的判定点就是「**有没有一条握手成功的活连接**」：
 * 0 → ≥1 打 `op=runtime-ready phase=ok`（debug），≥1 → 0 打 `phase=error`（warn）。
 * 这个时长门槛用来滤掉客户端 `dialOnce` 那种「开流 → initialize → 立刻丢」的探活，
 * 否则每次探活都会假报一次「掉回未就绪」。
 */
const READY_EPISODE_MIN_MS = 5_000;

export async function serveSocket(
  controller: Controller,
  options: SocketServeOptions = {}
): Promise<SocketServeHandle> {
  const socketPath = options.socketPath ?? DEFAULT_WORKSPACE_SERVER_SOCKET_PATH;
  const logger = options.logger;
  const server = createServer();
  const hub = createWireSessionHub(controller);

  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await unlinkStaleSocket(socketPath);

  // [XG-CUSTOM 2026-11-05] 每条连接 = 客户端的一条「候选流」。
  // 客户端的探活是 `dialOnce`：开通道 → `initialize` → 立刻 close（见
  // `core/services/hosts/node/workspace-server/connect/wire-connection-manager.ts`）；
  // 保留连接由 Host supervisor 另开。所以「进过几条流 / 哪条没 initialize 就断了」
  // 就是「哪一条流被拒」的直接判据。
  let connectionSeq = 0;
  let readySessions = 0;
  let readyEpisodeStartedAt = 0;

  server.on('connection', (socket) => {
    const conn = `conn#${++connectionSeq}`;
    const openedAt = Date.now();
    let socketError: Error | undefined;
    let clientVersion: string | undefined;
    let clientId: string | undefined;
    let clientProtocolVersion: string | undefined;

    // 原来这里是空 handler（**吞掉错误**）。现在照旧不外抛、不影响握手，
    // 只是把这个「一直没人看见」的错误抄进日志。
    socket.on('error', (error: Error) => {
      socketError = error;
      xgWireFailThrottled(logger, `socket-error:${conn}`, 10_000, {
        op: 'socket',
        reason: 'socket-error',
        conn,
        errorCode: (error as NodeJS.ErrnoException).code,
        errorMessage: error.message,
      });
    });

    xgWire(logger, 'debug', {
      op: 'session',
      phase: 'enter',
      conn,
      socketPath,
      peer: peerLabel(socket),
      connectionSeq,
      readySessions,
    });

    const probe = xgProbeTransport(socketTransport(socket), {
      conn,
      logger,
      onHello: (hello) => {
        clientId = hello.clientId;
        clientVersion = hello.clientVersion;
        clientProtocolVersion = hello.clientProtocolVersion;
      },
      onInitializeSettled: (outcome) => {
        if (outcome !== 'ok') return;
        readySessions += 1;
        if (readySessions === 1) {
          readyEpisodeStartedAt = Date.now();
          xgWireOk(logger, {
            op: 'runtime-ready',
            reason: 'first-ready-session',
            conn,
            readySessions,
            clientId,
            clientVersion,
            protocolVersion: clientProtocolVersion,
          });
          return;
        }
        xgWire(logger, 'debug', {
          op: 'runtime-ready',
          phase: 'ok',
          reason: 'additional-ready-session',
          conn,
          readySessions,
        });
      },
    });

    hub.open(randomUUID(), probe.transport);

    socket.once('close', (hadError) => {
      const summary = probe.summary();
      const ms = Date.now() - openedAt;
      // 只要**曾经**握手成功过就算 ready 过（重复 initialize 失败不能让计数漏掉）。
      const wasReady = summary.initializeOk;
      if (wasReady) readySessions = Math.max(0, readySessions - 1);

      const reason = closeReason({ socketError, hadError, summary });
      const fields = {
        conn,
        ms,
        bytesRead: socket.bytesRead,
        bytesWritten: socket.bytesWritten,
        msgsIn: summary.msgsIn,
        msgsOut: summary.msgsOut,
        calls: summary.calls,
        firstCallPath: summary.firstCallPath,
        initialize: summary.initialize,
        initializeOk: summary.initializeOk,
        initializeAttempts: summary.initializeAttempts,
        clientId,
        clientVersion,
        protocolVersion: clientProtocolVersion,
        errorResults: summary.errorResults,
        errorCodes: summary.errorCodes,
        lastErrorPath: summary.lastErrorPath,
        lastErrorCode: summary.lastErrorCode,
        postFailures: summary.postFailures,
        readySessions,
      };

      if (reason === undefined) {
        xgWireOk(logger, { op: 'session', ...fields, note: 'closed' });
      } else {
        xgWireFail(logger, { op: 'session', ...fields, reason });
      }

      // 「就绪 → 掉回未就绪」：只有握手成功过的连接才算数，且要跨过探活时长门槛。
      if (wasReady && readySessions === 0) {
        const episodeMs = Date.now() - readyEpisodeStartedAt;
        if (episodeMs >= READY_EPISODE_MIN_MS) {
          xgWireFailThrottled(logger, 'runtime-not-ready', 60_000, {
            op: 'runtime-ready',
            reason: 'no-ready-session',
            conn,
            episodeMs,
            clientId,
            clientVersion,
            protocolVersion: clientProtocolVersion,
            closeReason: reason ?? 'closed',
          });
        } else {
          xgWire(logger, 'debug', {
            op: 'runtime-ready',
            phase: 'error',
            reason: 'ready-episode-too-short',
            conn,
            episodeMs,
            closeReason: reason ?? 'closed',
          });
        }
      }
    });
  });

  await listen(server, socketPath);

  xgWire(logger, 'debug', { op: 'listen', phase: 'ok', socketPath, pid: process.pid });

  return {
    socketPath,
    async dispose() {
      await hub.dispose();
      await closeServer(server);
      await unlink(socketPath).catch(() => {});
    },
  };
}

/**
 * [XG-CUSTOM 2026-11-05] 连接关闭原因分类：**异常才 warn**，正常关闭走 debug。
 * 这些 reason 就是「客户端来问了没有 / 服务端为什么不给 ready」的答案枚举。
 */
function closeReason(input: {
  socketError: Error | undefined;
  hadError: boolean;
  summary: { msgsIn: number; initialize: 'none' | 'ok' | 'error' };
}): string | undefined {
  if (input.socketError !== undefined) return 'socket-error';
  if (input.hadError) return 'socket-closed-with-error';
  if (input.summary.msgsIn === 0) return 'closed-without-message';
  if (input.summary.initialize === 'error') return 'initialize-failed';
  if (input.summary.initialize === 'none') return 'closed-before-initialize';
  return undefined;
}

/**
 * [XG-CUSTOM 2026-11-05] 对端标识。Unix socket 上 Node 不暴露 `SO_PEERCRED`
 * （`remoteAddress` 恒 undefined，且这里是 ssh 端口转发过来的本地连接）⇒ 只能如实记
 * `unix-socket`；真正的「对端是谁」由日志里的 `conn` + `clientId`/`clientVersion` 关联。
 */
function peerLabel(socket: Socket): string {
  const address = socket.remoteAddress;
  if (address === undefined) return 'unix-socket';
  return `${address}:${socket.remotePort ?? ''}`;
}

async function unlinkStaleSocket(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) return;
  const live = await canConnect(socketPath);
  if (live) {
    throw new Error(`Workspace server socket is already in use: ${socketPath}`);
  }
  await unlink(socketPath);
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function socketTransport(socket: Socket): WireTransport {
  const transport = streamTransport(socket, socket);
  return {
    ...transport,
    close() {
      transport.close?.();
      socket.destroy();
    },
  };
}
