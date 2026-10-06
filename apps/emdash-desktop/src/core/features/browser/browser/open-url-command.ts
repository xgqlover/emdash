// [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（命令 id `browser.openUrl`）的**纯逻辑**（可离线单测）。
//
// 为什么要有这个模块（用户真机反馈）：
//   用户想「在 emdash 里打开一个网址」，点工具栏那颗按钮弹出来的是 **Forward Port**
//   （`preview-servers/manual-forward-dialog.tsx`：把**远端端口**隧道到本机预览 dev server，5173 只是占位）。
//   那条路跟「打开网址」不是一回事。这里给命令面板（Ctrl+K）一条**真正**的入口。
//
// 三条硬规矩（都在下面的纯函数里，且被 open-url-command.test.ts 钉住）：
//   ① 只收 `http(s)://`。`javascript:` / `file:` / `data:` / `mailto:` 一律**如实拒绝**
//      —— 这是安全边界，绝不能让命令把任意 scheme 塞进内嵌浏览器。
//   ② 用户没带协议（如 `g-mark.org`）→ 补 `https://`（写清、可测；不带协议的输入**一律** https）。
//   ③ 空 / 非法**如实提示**，绝不静默、也绝不回退到系统浏览器。
//
// 这里**不**碰 WebContentsView、**不**碰 9223 桥的白名单；开页只走 paneLayout.open('browser', …)（见下）。
const EXPLICIT_SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const HTTP_SCHEME_PATTERN = /^https?$/i;
// 冒号后面只有端口（`127.0.0.1:8080` / `localhost:5173` / `example.com:3000`）——
// 这种「伪协议」不是协议，是 host:port，要当无协议处理（否则 `localhost:5173` 会被误判成不支持的协议）。
const PORT_ONLY_PATTERN = /^\d+(?:[/?#].*)?$/;

export interface OpenUrlInputOk {
  readonly ok: true;
  readonly url: string;
}

export interface OpenUrlInputError {
  readonly ok: false;
  readonly message: string;
}

export type OpenUrlInputResult = OpenUrlInputOk | OpenUrlInputError;

/**
 * 把用户输入的网址解析成「可以直接交给内嵌浏览器」的绝对 URL。非法就带回中文原因（如实提示）。
 */
export function resolveOpenUrlInput(raw: string): OpenUrlInputResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, message: '请输入网址（例如 https://example.com）' };
  }

  const scheme = EXPLICIT_SCHEME_PATTERN.exec(trimmed)?.[1];
  let candidate = trimmed;
  if (scheme === undefined) {
    // 没写协议 → 补 https://（`g-mark.org` → `https://g-mark.org`）
    candidate = `https://${trimmed}`;
  } else if (!HTTP_SCHEME_PATTERN.test(scheme)) {
    if (PORT_ONLY_PATTERN.test(trimmed.slice(scheme.length + 1))) {
      candidate = `https://${trimmed}`;
    } else {
      return { ok: false, message: `只支持 http/https 网址（收到的是 ${scheme}: 协议）` };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, message: '网址无效，请检查后重试（例如 https://example.com）' };
  }

  if (!HTTP_SCHEME_PATTERN.test(parsed.protocol.replace(/:$/, ''))) {
    return { ok: false, message: '只支持 http/https 网址' };
  }
  if (parsed.hostname === '') {
    return { ok: false, message: '网址缺少主机名（例如 https://example.com）' };
  }
  if (!isUsableHostname(parsed.hostname)) {
    return { ok: false, message: '请输入完整网址（例如 https://example.com）' };
  }

  return { ok: true, url: parsed.toString() };
}

/** 主机名要像个主机名：带点（域名/IPv4）、或 localhost、或 [IPv6] 字面量。 */
function isUsableHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[')) return true;
  return hostname.includes('.');
}

export type OpenUrlCommandPlan =
  /** 没带 url —— 命令面板选中项只能以 undefined 调用，这时必须弹「输入网址」框 */
  | { readonly kind: 'prompt' }
  /** 带 url 且合法 —— 直接开 */
  | { readonly kind: 'open'; readonly url: string }
  /** 带 url 但不合法 —— 如实提示，不静默、不回退系统浏览器 */
  | { readonly kind: 'error'; readonly message: string };

/** `browser.openUrl` 的 run/validate 决策（纯函数）。 */
export function planOpenUrlCommand(
  input: { readonly url?: string } | undefined
): OpenUrlCommandPlan {
  const raw = input?.url;
  if (typeof raw !== 'string' || raw.trim() === '') return { kind: 'prompt' };
  const resolved = resolveOpenUrlInput(raw);
  return resolved.ok
    ? { kind: 'open', url: resolved.url }
    : { kind: 'error', message: resolved.message };
}

/** 开页需要的最小能力面 —— 只取 task view 里的这两样，便于单测注入假实现。 */
export interface OpenUrlBrowserTarget {
  readonly paneLayout: {
    open(kind: 'browser', args: { readonly initialUrl: string }): unknown;
  };
  setFocusedRegion(region: 'main'): unknown;
}

/**
 * 真正开页的一步：与 `task.openBrowser` / 预览 pill / 外部链接确认框**同一条路** ——
 * `paneLayout.open('browser', { initialUrl })`，不新建 WebContentsView、不动 9223 白名单。
 * 返回是否开成（拿不到 task view 时 false，调用方如实提示）。
 */
export function openUrlInBrowserPane(
  target: OpenUrlBrowserTarget | undefined,
  url: string
): boolean {
  if (target === undefined) return false;
  target.paneLayout.open('browser', { initialUrl: url });
  target.setFocusedRegion('main');
  return true;
}
