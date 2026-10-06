import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, session, type Session } from 'electron';
import type { AppSettings } from '@core/services/settings/api';
import { log } from '@main/lib/logger';
import {
  applyLocalDevelopmentCorsRelaxation,
  localDevelopmentCorsRelaxationRequest,
  type BrowserCorsRelaxationRequest,
} from './browser-cors-relaxation';
import {
  firefoxUserAgent,
  isGoogleAuthUrl,
  stripEmbeddedBrowserTokens,
} from './browser-user-agent';
// [XG-CUSTOM] 内嵌浏览器代理解析（env → 配置文件 → 非 Linux 缺省；见该文件头）
import { resolveXiangwoBrowserProxy } from './xiangwo-browser-proxy';
// [XG-CUSTOM] bot ⟷ profile 绑定快照（设置 → 浏览器的 profiles[].botId）
import { setXiangwoBrowserProfileBindings } from './xiangwo-bot-browser-profile';

// Web permissions the embedded browser may use without asking. Everything else
// (camera, microphone, geolocation, notifications, USB/HID/serial, …) is denied:
// the in-app browser holds logged-in sessions and must not become a side channel
// into device capabilities (Electron security checklist #5).
const ALLOWED_BROWSER_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
]);

const configuredPartitions = new Set<string>();
let relaxCorsForLocalDevelopment = false;

export function setBrowserCorsRelaxationSettings(browser: AppSettings['browser']): void {
  relaxCorsForLocalDevelopment = browser.relaxCorsForLocalhost;
  // [XG-CUSTOM] 同一个调用点顺手把 bot⟷profile 绑定刷进主进程快照（9223 桥 / 反向通道查表用）
  setXiangwoBrowserProfileBindings(browser);
}

/**
 * Returns the session for a browser partition, applying profile-wide hardening
 * exactly once per partition: deny-by-default permissions, an embedded-browser
 * user agent without Electron tokens, and a Firefox user agent on Google auth
 * hosts so third-party "Sign in with Google" flows are not rejected.
 */
export function configureBrowserProfileSession(partition: string): Session {
  const ses = session.fromPartition(partition);
  if (configuredPartitions.has(partition)) return ses;
  configuredPartitions.add(partition);

  // [XG-CUSTOM] 内嵌浏览器走 socks5 代理上外网（Windows 客户端连 Linux 主机的 socks5-proxy.py）。
  // 取值优先级：环境变量 XIANGWO_BROWSER_PROXY → userData/xiangwo-browser-proxy.json →
  // 非 Linux 客户端缺省 socks5://10.239.5.174:1080 ([XG-CUSTOM] 2026-10-06 由 Tailscale 地址改为
  // ZeroTier · Windows 实测后者 12/12、前者 0/12；Windows 打包版照旧能配，见
  // host/browser/xiangwo-browser-proxy.ts 的文件头)。任何异常/缺值都只是"不用代理"，
  // **绝不因为变量缺失而崩**。只影响浏览器 partition session，不影响 emdash 主连接。
  const browserProxy = resolveXiangwoBrowserProxy({
    readConfigFile: (fileName) => readFileSync(join(app.getPath('userData'), fileName), 'utf8'),
    log: (message, metadata) => {
      log.warn(`[xiangwo-browser-proxy] ${message}`, metadata);
    },
  });
  if (browserProxy?.proxy !== undefined) {
    const proxy = browserProxy.proxy;
    ses
      .setProxy({ proxyRules: proxy })
      .then(() => {
        log.info('Browser proxy enabled', { proxy, source: browserProxy.source });
      })
      .catch((error: unknown) => {
        log.warn('Browser proxy setup failed (keeping direct connection)', {
          proxy,
          error: String(error),
        });
      });
  } else if (browserProxy !== undefined) {
    log.info('Browser proxy disabled by configuration', { source: browserProxy.source });
  }

  ses.setUserAgent(stripEmbeddedBrowserTokens(ses.getUserAgent(), app.getName()));

  const corsRequests = new Map<number, BrowserCorsRelaxationRequest>();

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (isGoogleAuthUrl(details.url)) {
      details.requestHeaders['User-Agent'] = firefoxUserAgent();
    }

    const corsRequest = relaxCorsForLocalDevelopment
      ? localDevelopmentCorsRelaxationRequest(details.requestHeaders)
      : null;
    if (corsRequest) corsRequests.set(details.id, corsRequest);
    else corsRequests.delete(details.id);

    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const corsRequest = corsRequests.get(details.id);
    corsRequests.delete(details.id);
    if (!relaxCorsForLocalDevelopment || !corsRequest || !details.responseHeaders) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: applyLocalDevelopmentCorsRelaxation(details.responseHeaders, corsRequest),
    });
  });

  ses.webRequest.onCompleted((details) => {
    corsRequests.delete(details.id);
  });
  ses.webRequest.onErrorOccurred((details) => {
    corsRequests.delete(details.id);
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const granted = ALLOWED_BROWSER_PERMISSIONS.has(permission);
    if (!granted) {
      log.debug('Denied browser permission request', { permission });
    }
    callback(granted);
  });
  ses.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_BROWSER_PERMISSIONS.has(permission)
  );

  return ses;
}
