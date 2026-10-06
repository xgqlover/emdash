import { app, dialog } from 'electron';
import { configureChromiumCommandLine } from '@main/host/chromium-command-line';
import { log } from '@main/lib/logger';

// Packaged Electron does not set NODE_ENV, so environment-keyed defaults (such
// as the wire validation policy) would otherwise resolve to their development
// behavior. Set it before any other module loads so spawned workers inherit it.
if (app.isPackaged && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

// Electron consumes Chromium switches during initialization. Keep this call
// synchronous at module scope, before bootstrap's dynamic import crosses an
// event-loop boundary and `ready` may be emitted.
// [XG-CUSTOM] 2026-10-06 —— 顺带把这一跳的诊断写进日志文件（`log.warn` 是 pino，落 emdash.log）。
// 此时 `initializeFileLogger()` 还没跑，文件路径尚未解析；FileTransport 是**惰性解析路径**的，
// 所以这一句要么丢掉、要么落到正确文件，绝不会写错地方（入口是同步的，不能 await 初始化）。
configureChromiumCommandLine({
  commandLine: app.commandLine,
  logger: (message, fields) => log.warn(message, fields),
});

async function start(): Promise<void> {
  try {
    const { main } = await import('@main/bootstrap');
    await main();
  } catch (error) {
    try {
      const { enterSafeMode } = await import('@main/bootstrap/core/recovery');
      await enterSafeMode(error);
    } catch (recoveryError) {
      await app.whenReady();
      dialog.showErrorBox(
        'Something went wrong',
        `Emdash could not start recovery mode.\n\n${
          recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        }`
      );
    }
  }
}

void start();
