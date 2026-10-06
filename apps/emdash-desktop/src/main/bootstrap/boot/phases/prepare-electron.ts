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
  configureDohHostResolver({ app });
}

async function showMainWindow(): Promise<void> {
  const windowModule = await import('@main/host/window');
  windowModule.showMainWindow();
}
