import { configureDohCommandLine } from './chromium-doh';
import { LIBSECRET_PASSWORD_STORE, shouldForceLibsecretBackend } from './linux-secret-storage';

type ChromiumCommandLine = {
  appendSwitch(name: string, value?: string): void;
  hasSwitch(name: string): boolean;
};

type ConfigureChromiumCommandLineOptions = {
  commandLine: ChromiumCommandLine;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** [XG-CUSTOM] 2026-10-06 —— 落盘诊断（入口处传 `log.warn`；缺省不打，单测零噪音）。 */
  logger?: (message: string, fields?: Record<string, unknown>) => void;
};

/** Apply Chromium switches that must be set before Electron emits `ready`. */
export function configureChromiumCommandLine({
  commandLine,
  env = process.env,
  platform = process.platform,
  logger,
}: ConfigureChromiumCommandLineOptions): void {
  // [XG-CUSTOM] 2026-10-06 —— 让内嵌浏览器走我们自己的 DoH（`XIANGWO_DOH=0` 可关）。
  // 与平台无关（Win/mac 同样要吃假 AAAA 的亏），所以放在下面 linux 早退**之前**。
  configureDohCommandLine({ commandLine, env, logger });

  if (platform !== 'linux') return;

  commandLine.appendSwitch('ozone-platform-hint', 'auto');
  if (
    shouldForceLibsecretBackend(env, {
      passwordStoreSwitchPresent: commandLine.hasSwitch('password-store'),
    })
  ) {
    commandLine.appendSwitch('password-store', LIBSECRET_PASSWORD_STORE);
  }
}
