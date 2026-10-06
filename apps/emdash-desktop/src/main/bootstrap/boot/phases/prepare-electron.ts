import { app } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { configureDohHostResolver } from '@main/host/chromium-doh';
import { initializeFileLogger, registerProcessErrorLogging } from '@main/host/file-logger';
import { registerAppScheme } from '@main/host/protocol';
import { log } from '@main/lib/logger';
import type { AppConfig } from '../../core/config';
import { step } from '../../core/phase';
import { BootAborted, type BootSignals } from '../types';

export async function prepareElectron(config: AppConfig, signals: BootSignals): Promise<void> {
  registerAppScheme();
  initializeFileLogger();
  registerProcessErrorLogging(log);

  app.on('second-instance', () => {
    if (signals.windowPhaseReady) void showMainWindow();
  });

  if (!config.isDev && !app.requestSingleInstanceLock()) {
    app.quit();
    throw new BootAborted('Another application instance is already running');
  }

  if (config.isDev) {
    try {
      app.dock?.setIcon(devIcon);
    } catch (error) {
      log.warn('Failed to set dock icon:', error);
    }
  }

  app.on('activate', () => {
    if (signals.windowPhaseReady) void showMainWindow();
  });

  // Emdash remains available from the tray when its main window is destroyed.
  // Explicit quit requests are coordinated through the before-quit handler.
  app.on('window-all-closed', () => {});

  await step('electron-app-ready', () => app.whenReady());

  // [XG-CUSTOM] 2026-10-06 —— 让内嵌浏览器走我们自己的 DoH（治假 AAAA `2001::1` → ERR_TIMED_OUT）。
  // 必须在 ready **之后**调用（Electron 文档：after the ready event）；这里是 boot 第一个 phase，
  // 主窗口与内嵌浏览器都还没建 ⇒ 任何一次解析之前就已生效。`XIANGWO_DOH=0` 可整条关掉。
  //
  // [XG-CUSTOM] 2026-10-06 —— 落点/时序结论（第三轮诊断）：**这个落点是对的，不要挪**。
  //   · `prepareElectron` 由 `runBootPreflight()` 在 `bootWindow()` **之前** await，
  //     而 `bootWindow()` 才是建窗/加载渲染进程的地方 ⇒ 这里已经是"ready 之后、任何一次网页解析之前"
  //     最早且唯一安全的点。
  //   · 再往后挪（ready + 首窗创建之后）只会**更晚**：主窗口 chunk 一加载就可能解析域名，
  //     那时 `configureHostResolver` 会因主机解析器已被用过而抛错（本身也确实是"太晚"）。
  //   · `configureDohHostResolver` 现在 **async**：内部先做 ≤1.5s 可达性探测（探测不通就不配，
  //     绝不把内嵌浏览器 DNS 闭死）。这一步会**等待**，所以必须 await，否则 boot 会继续往下建窗。
  //   · 诊断日志走 `log.warn`（pino，落 `~/.config/emdash/logs/emdash.log`）；
  //     `console.warn` **不进那个文件**，这就是上一轮"日志里一行 DoH 都没有"的原因。
  await configureDohHostResolver({ app, logger: (message, fields) => log.warn(message, fields) });
}

async function showMainWindow(): Promise<void> {
  const windowModule = await import('@main/host/window');
  windowModule.showMainWindow();
}
