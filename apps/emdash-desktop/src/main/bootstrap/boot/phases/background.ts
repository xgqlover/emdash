import { systemPreferences } from 'electron';
import { integrationsEvents } from '@core/features/integrations/node/event-host';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import { autostartXiangwoOrb, startXiangwoBrowserRelay, startXiangwoCdpBridge } from '../wiring'; // [XG-CUSTOM]
import { startMainDevPerfInstruments } from './dev-perf';
import { startPerfVitalsTelemetry } from './perf-vitals';
import type { ServicesBundle } from './services';
import { initializeUpdater } from './updater';

export function bootBackground(services: ServicesBundle, runtimes: DesktopRuntimes): void {
  startMainDevPerfInstruments();
  startPerfVitalsTelemetry(runtimes);

  // Updater init hits the network and must never block the boot chain; it
  // moved out of preflight under the window-first boot (spec build issue 2).
  runInBackground('updater-initialize', initializeUpdater);

  runInBackground('dependency-probe', async () => {
    await runtimes.clients.hostDependencies.snapshot.mutate('refresh', {
      key: undefined,
      input: {},
    });
  });

  if (
    process.platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('microphone') !== 'granted'
  ) {
    runInBackground('microphone-permission', async () => {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      log.info('Microphone access request resolved:', { granted });
    });
  }

  runInBackground('github-account-reconciliation', async () => {
    // Run-once upgrade step (spec: github-git-settings §10): after the first
    // successful run this reads one flag row and performs no backfill work.
    try {
      if ((await services.github.legacyTokenImport.run()) === 'retry') {
        log.warn('Legacy GitHub account migration is incomplete; retrying next launch');
      }
    } catch (error) {
      log.warn('Legacy GitHub token import failed; retrying next launch', { error });
    }

    try {
      await services.github.cliImport.importAccounts();
    } catch (error) {
      log.warn('Failed to import GitHub CLI accounts during startup', { error });
    }

    integrationsEvents.emit(undefined, {
      type: 'accounts-changed',
      providerId: 'github',
    });
  });

  // [XG-CUSTOM] 项我球（orb）启动常驻：这一步在 window/service 阶段与 wire 注册（controllers/gateway）
  // 之后运行，所以不会和窗口初始化竞争。开关 XIANGWO_ORB_AUTOSTART=0 与失败兜底都在
  // wiring.ts 的 autostartXiangwoOrb（失败只打日志，绝不影响主窗口启动）。
  autostartXiangwoOrb();

  // [XG-CUSTOM] 内嵌浏览器 CDP 桥（agent.py 第②级「内嵌浏览器优先」，localhost:9223；
  // 历史叫法「iframe 合流」，实现是 <webview> + 白名单 CDP，不是 iframe）。
  // 和球一样放在 boot 最后：此时 service/wire 阶段都完成，browserWebContentsRegistry 可用。
  startXiangwoCdpBridge();

  // [XG-CUSTOM] 内嵌浏览器**反向命令通道**（跨机主路径，出站 only）：主动拨回 Linux agent 的
  // 8900 长轮询，命令在本机执行、结果沿同一条出站通道回传。对面**不用开入站端口/不写防火墙/
  // 不做来源白名单**（HippoBuddy 的机制）。执行面复用上面那台 9223 桥（只碰内嵌浏览器）。
  // 地址跟随球面板的解析（XIANGWO_BROWSER_RELAY_URL > SSH 转发 > 主机地址）；失败只退避重试。
  startXiangwoBrowserRelay();
}
