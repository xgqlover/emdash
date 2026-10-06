// [XG-CUSTOM] 2026-10-05 —— **球的「指挥主界面」动作块**（`[XG-ACTION]{…}[/XG-ACTION]`）解析 + 执行。
//
// 用户要求：「球要用到的网页，跟别的功能主界面要同步支持」。
// 事实源 = 主界面命令目录的子集（`main/host/xiangwo-host-commands.ts` 白名单）；
// 本文件是**球侧的一段**：把 agent 回复里的动作块解析出来 → 调 `orbApi('host.runCommand')`。
//
// 三条约定（与审批卡/提问卡同族）：
//   ① **声明式**：只传命令 id + 参数，**不传代码**；
//   ② **白名单在服务端**（主进程再查一次表）—— 球侧只做格式校验，**不自己判合法性**（避免两边漂移）；
//   ③ **回执如实**：主进程回 `{ok:false, reason}` 时**照原样说出来**（unknown-command / needs-approval /
//      unavailable / failed），**不假装成功**。
//
// [XG-CUSTOM] 2026-10-06 **唯一的例外：直连方法表**（见下 `DIRECT_ACTIONS`）——
//   用户要「用文字指挥 emdash 开网页」，但白名单里 8 条 UI 命令**没有一条能开网页**，
//   而 `host.openEmbeddedBrowser` **本就是独立、已经接好的 orbApi 方法**（球里点图片卡片走的就是它，
//   见 ./xiangwo-images.ts / main/host/xiangwo-orb-api.ts）。所以「开网页」不走 `host.runCommand`，
//   直接命中那张表 → `run('host.openEmbeddedBrowser', …)`。
//   🔴 表里**只有这一个 id**：不动白名单、不动主进程注入，也**绝不**把 `host.*` 通配放开。
//
// 回归测试见 ./xiangwo-action.test.ts
export const XIANGWO_ACTION_RE = /```xiangwo-action\s*\n([\s\S]*?)```/g;

/** 直连方法表里唯一的一条：在 emdash 内嵌浏览器里开网页（id = orbApi 的方法名）。 */
// [XG-CUSTOM] 2026-10-06 开网页这条通道的 id（与主进程 `host.openEmbeddedBrowser` 同名）。
export const XIANGWO_OPEN_EMBEDDED_BROWSER_ID = 'host.openEmbeddedBrowser';

/** 球的「直连通道」动作 id → orbApi 方法名。**只登记已通且可安全直连的方法**。 */
// [XG-CUSTOM] 2026-10-06 只放 `host.openEmbeddedBrowser` 一个；条目形状是 `动作id → 方法名`，
//   为的是**动作 id 可以不同于方法名**（将来若要包一层别名，也不用改执行逻辑）。
export const XIANGWO_DIRECT_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  [XIANGWO_OPEN_EMBEDDED_BROWSER_ID]: XIANGWO_OPEN_EMBEDDED_BROWSER_ID,
});

/** 只认 http/https（白名单式判断：其余一律拒，**不**退化成系统浏览器）。 */
// [XG-CUSTOM] 2026-10-06 用 `startsWith` 而不是正则，避免 `javascript:` / `file:` / `data:` 之类漏网。
function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 把动作参数整理成 `host.openEmbeddedBrowser` 要的形状。
 *
 * [XG-CUSTOM] 2026-10-06 三条（与主进程同口径，球侧先自查一遍只为**早失败 + 说人话**）：
 *   ① url 必填且必须是 http(s) —— 空/非法 → `null`（调用方回 `bad-url`，**不发起调用**）；
 *   ② bot 选填，只有非空字符串才透传（空串等于没指定，与 ./xiangwo-images.ts 一致）；
 *   ③ payload 里只放这两个键 —— 多余参数**不转发**（少一个泄面）。
 */
function buildOpenEmbeddedBrowserPayload(args: unknown): { url: string; bot?: string } | null {
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!isHttpUrl(url)) return null;
  const bot = typeof record.bot === 'string' ? record.bot.trim() : '';
  return bot === '' ? { url } : { url, bot };
}

export interface XiangwoAction {
  /** 主界面命令 id（如 `app.settings`） */
  readonly id: string;
  /** 可选参数（结构化克隆友好） */
  readonly args?: unknown;
}

export interface XiangwoActionResult {
  readonly ok: boolean;
  /** 失败原因（主进程原样回的：unknown-command / needs-approval / unavailable / failed） */
  readonly reason?: string;
  readonly message?: string;
}

/** 从回复正文里解析动作块（可能多个）。解析失败/形状不对 → 跳过该块（不抛）。 */
export function parseXiangwoActionBlock(text: string): XiangwoAction[] {
  const out: XiangwoAction[] = [];
  const source = text ?? '';
  for (const match of source.matchAll(XIANGWO_ACTION_RE)) {
    const body = (match[1] ?? '').trim();
    if (body === '') continue;
    try {
      const parsed: unknown = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        if (id === '') continue;
        out.push(record.args === undefined ? { id } : { id, args: record.args });
      }
    } catch {
      // 坏 JSON 静默跳过：宁可少做一个动作，也不要因为一段坏块打断整条回复
    }
  }
  return out;
}

/** 去掉动作块（给球渲染正文用，免得把 JSON 也显示出来）。 */
export function stripXiangwoActionBlocks(text: string): string {
  return (text ?? '').replace(XIANGWO_ACTION_RE, '').trim();
}

/**
 * 主进程回执 → 球侧结果：**照原样**（`{ok:false,reason,message}` 不粉饰）。
 * [XG-CUSTOM] 2026-10-06 从 `runXiangwoAction` 里提出来，直连/白名单两条路共用同一套判定。
 */
function toActionResult(raw: unknown): XiangwoActionResult {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    if (record.ok === true) return { ok: true };
    return {
      ok: false,
      reason: typeof record.reason === 'string' ? record.reason : 'failed',
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    };
  }
  return { ok: false, reason: 'failed' };
}

/**
 * 执行一个动作：交给调用方注入的 `run`（球里就是 `orbApi('host.runCommand', …)`）。
 * **不抛**：任何异常都收敛成 `{ok:false, reason:'failed'}`，如实回报。
 *
 * [XG-CUSTOM] 2026-10-06 命中直连表（当前只有「开网页」）→ 直接 `run('host.openEmbeddedBrowser', …)`，
 * **不走** `host.runCommand`（白名单里没这条；走了必然回 unknown-command）。其余动作**原路不变**。
 */
export async function runXiangwoAction(
  action: XiangwoAction,
  run: (method: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<XiangwoActionResult> {
  try {
    // [XG-CUSTOM] 2026-10-06 直连：只此一条，且**只**开网页；非法 url 当场拒（一次调用都不发）。
    const directMethod = XIANGWO_DIRECT_ACTIONS[action.id];
    if (directMethod === XIANGWO_OPEN_EMBEDDED_BROWSER_ID) {
      const payload = buildOpenEmbeddedBrowserPayload(action.args);
      if (payload === null) return { ok: false, reason: 'bad-url' };
      return toActionResult(await run(directMethod, payload));
    }
    const raw = await run('host.runCommand', {
      id: action.id,
      ...(action.args === undefined ? {} : { args: action.args }),
    });
    return toActionResult(raw);
  } catch (error) {
    return { ok: false, reason: 'failed', message: String(error) };
  }
}

/**
 * [XG-CUSTOM] 2026-10-06 —— 「球开网页」**收敛成一套**：同一条回复里两种块都出现时，**只开一次**。
 *
 * 背景：渲染侧现在同时认两种块，而它们最后都调同一个 `host.openEmbeddedBrowser`：
 *   ① ` ```xiangwo-open-url ` 块（方案 A，修复文档点名的写法）→ `openXiangwoUrls()`
 *   ② ` ```xiangwo-action {"id":"host.openEmbeddedBrowser","args":{"url":…}}` → 直连表 → `runXiangwoAction()`
 * 模型若把两种块都发出来（或同一个 URL 发两遍），页会被开两遍 —— 多一个标签页。
 *
 * 语义（只做过滤，不改顺序、不改对象）：
 *   · **只对"开网页"这一个 id 生效**，别的动作（`app.settings` 之类）原样返回，零影响；
 *   · URL 空/不合法/不在 `openedUrls` 里 → **保留**（该开的还是要开）；
 *   · `openedUrls` 为空 → 原样返回（调用方零回归）。
 *
 * 现在的分工（**一套**）：agent 语言侧只发 ①/② 中**一种**（当前发 ②，因为用户手上的 exe
 * 里还没有 ① 的解析器；下次打包后可切到 ①），渲染侧两种都认 + 这里去重。
 */
export function dropOpenUrlActionsAlreadyOpened(
  actions: readonly XiangwoAction[],
  openedUrls: readonly string[]
): XiangwoAction[] {
  if (actions.length === 0 || openedUrls.length === 0) return [...actions];
  const opened = new Set(
    openedUrls.map((u) => (typeof u === 'string' ? u.trim() : '')).filter((u) => u !== '')
  );
  if (opened.size === 0) return [...actions];
  return actions.filter((action) => {
    if (action.id !== XIANGWO_OPEN_EMBEDDED_BROWSER_ID) return true;
    const args = action.args;
    const url =
      typeof args === 'object' &&
      args !== null &&
      typeof (args as Record<string, unknown>).url === 'string'
        ? ((args as Record<string, unknown>).url as string).trim()
        : '';
    return !(url !== '' && opened.has(url));
  });
}

/**
 * [XG-CUSTOM] 2026-10-06 —— **副作用只执行一次**的判定（治"一次请求冒出 4~5 个同样的页"）。
 *
 * 真机事故：球的 `renderTranscript()` 是**整表重绘**，而"开页/动作"是**在渲染循环里直接执行**的
 * ⇒ 每重绘一次就把消息里的 `xiangwo-open-url` 块 / 动作块**重放一遍**（边流边重绘 → 4~5 个同页）。
 * 而且重启/切会话后**历史消息也会被重新渲染**，若不拦就等于"开一次球把旧页全开一遍"。
 *
 * 判据（刻意做成**白名单**，不怕漏拦）：
 *   · **只有本次会话里新产生的消息**（`message.xgLive === true`，由实时发送/流式路径打标）才允许执行副作用；
 *   · 历史消息（本地缓存 / 后端拉回 / 任何没打标的）**一律不执行**；
 *   · 非历史消息按 `key` 认领一次：**第一次 true，之后 false**。
 * `key` 具体到 URL / 动作参数（不是"整条消息一次性"）——这样流式消息后续才出现的新 URL 仍各开一次，
 * **既不重放，也不漏开**。
 */
export type SideEffectPrimer = {
  /** 认领一次副作用：非 `xgLive` 的消息永远 false；同一 key 只成功一次 */
  claim(message: object, key: string): boolean;
};

export function createSideEffectPrimer(): SideEffectPrimer {
  const claimed = new WeakMap<object, Set<string>>();
  return {
    claim(message, key) {
      if (typeof message !== 'object' || message === null) return false;
      if ((message as { xgLive?: unknown }).xgLive !== true) return false;
      let seen = claimed.get(message);
      if (seen === undefined) {
        seen = new Set<string>();
        claimed.set(message, seen);
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}

/** 失败原因 → 给用户看的一句话（不粉饰）。 */
export function actionFailureText(action: XiangwoAction, result: XiangwoActionResult): string {
  // [XG-CUSTOM] 2026-10-06 开网页这条路的两种失败要单独说清（别的动作走原来的话术，零回归）。
  if (action.id === XIANGWO_OPEN_EMBEDDED_BROWSER_ID) {
    if (result.reason === 'unavailable') return '球开网页这条通道没接上（主进程没注入），我没开。';
    if (result.reason === 'bad-url')
      return '这个地址不是 http(s) 开头（或者为空），我没开（也不会替你去开系统浏览器）。';
  }
  switch (result.reason) {
    case 'needs-approval':
      return `「${action.id}」属于写操作，需要你确认后我才能执行。`;
    case 'unknown-command':
      return `「${action.id}」不在可执行清单里，我没做（不会乱碰界面）。`;
    case 'unavailable':
      return `这条通道还没接上（主界面执行器没就绪），「${action.id}」没执行。`;
    default:
      return `「${action.id}」执行失败${result.message ? `：${result.message}` : ''}。`;
  }
}

// ── [XG-CUSTOM 2026-10-05] `xiangwo-open-url` 块：**让 emdash 主界面开网页**（方案 A）──
//
// 为什么另开一条而**不走白名单**（同一天 `emdash内嵌浏览器开错机器-修复OPS-2026-10-06` §TASK 4 的方案 A）：
//   `host.openEmbeddedBrowser` 是**球已有的独立 orbApi 方法，而且 boot 已经注入好了**
//   （`background.ts` 的 `configureOrbEmbeddedBrowserOpen` → `requestEmbeddedBrowserOpen`
//    → 主窗口 `openEmbeddedBrowserTab`）—— 球里点图片卡片走的就是它。
//   ⇒ 「让主界面开网页」**不需要** `configureOrbHostCommands` 注入、**不需要**动
//   CommandCatalog 白名单，**只需要球渲染侧认这个块**。做完**立刻可用**。
//   （方案 B：走白名单 + boot 注入命令执行器 —— 攒到下次打包，见台账 20/23。）

export const XIANGWO_OPEN_URL_RE = /```xiangwo-open-url\s*\n([\s\S]*?)```/g;

/** 解析块内容（`{"url":"https://…"}` 或 `["https://…", …]`）。**只收 http(s)**，其余跳过。 */
export function parseXiangwoOpenUrlBlock(text: string): string[] {
  const out: string[] = [];
  const source = text ?? '';
  const push = (value: unknown): void => {
    const url = typeof value === 'string' ? value.trim() : '';
    if (/^https?:\/\//.test(url) && !out.includes(url)) out.push(url);
  };
  for (const match of source.matchAll(XIANGWO_OPEN_URL_RE)) {
    const body = (match[1] ?? '').trim();
    if (body === '') continue;
    try {
      const parsed: unknown = JSON.parse(body);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'object' && item !== null)
            push((item as Record<string, unknown>).url);
          else push(item);
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        push((parsed as Record<string, unknown>).url);
      } else {
        push(parsed);
      }
    } catch {
      // 坏 JSON 静默跳过（宁可少开一个页，也不要因一段坏块打断整条回复）
    }
  }
  return out;
}

/** 去掉块（别把 JSON 显示给用户）。 */
export function stripXiangwoOpenUrlBlocks(text: string): string {
  return (text ?? '').replace(XIANGWO_OPEN_URL_RE, '').trim();
}

/**
 * 逐个交给注入的 `run`（球里 = `orbApi('host.openEmbeddedBrowser', {url})`）。
 * **不抛**：异常/失败收敛成 `{ok:false, reason}`，**如实回报**（不假装开好了）。
 */
export async function openXiangwoUrls(
  urls: readonly string[],
  run: (method: string, payload: Record<string, unknown>) => Promise<unknown>
): Promise<XiangwoActionResult> {
  if (urls.length === 0) return { ok: true };
  const failed: string[] = [];
  let reason = '';
  for (const url of urls) {
    try {
      const raw = await run('host.openEmbeddedBrowser', { url });
      const record =
        typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      if (record.ok !== true) {
        failed.push(url);
        reason = typeof record.reason === 'string' ? record.reason : 'failed';
      }
    } catch (error) {
      failed.push(url);
      reason = 'failed';
      void error;
    }
  }
  if (failed.length === 0) return { ok: true };
  return { ok: false, reason: reason === '' ? 'failed' : reason, message: failed.join(' ') };
}

// ── [XG-CUSTOM] 2026-10-06 —— 球的 🌐「打开网址」快入口：用户手输网址的**纯校验**（可离线单测）──
//
// 用户嫌 `browser.openUrl`（Ctrl+K → 弹框 → 粘贴 → 回车）绕，要「一个动作就给网址并打开」。
// 做法：点球底排 🌐 → 把球**已有的输入框**切成「待开页」模式 → 粘贴 → **回车**（这条模式下回车
// **不发聊天消息**）→ `openXiangwoUrls()`（= 已通的 `host.openEmbeddedBrowser` 通道，默认落在
// 用户当前 task，**不另加** profile/bot 参数）。Esc 取消复位。
//
// 校验口径与主界面 `browser.openUrl` 的 `resolveOpenUrlInput`
// （`@core/features/browser/browser/open-url-command.ts`）**逐条对齐**：
//   ① 只收 http(s)（`javascript:` / `file:` / `data:` / `mailto:` 一律如实拒，绝不回退系统浏览器）；
//   ② 没写协议 → 补 `https://`（`g-mark.org` → `https://g-mark.org`）；`localhost:5173` 这种
//      「host:port 伪协议」也当无协议处理（否则会被误判成不支持的协议）；
//   ③ 空 / 非法 → 回**中文原因**（调用方照原样显示，不静默）。
// 🔴 **刻意不 import 那个模块**：`orb.html` 是**独立 vite 入口**，而那个模块顺着
//   `open-browser-tab` 会把主界面的 paneLayout / mobx 那一坨拖进球的包 —— 为 40 行校验不值当。
//   两处的一致性由 `xiangwo-action.test.ts` 的「与主界面共用同一张用例表」钉住（漂移即红）。

const XG_URL_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const XG_HTTP_SCHEME_RE = /^https?$/i;
// 冒号后面只有端口（`127.0.0.1:8080` / `localhost:5173` / `example.com:3000`）—— 那不是协议，是 host:port。
const XG_PORT_ONLY_RE = /^\d+(?:[/?#].*)?$/;

export interface XiangwoOpenUrlInputOk {
  readonly ok: true;
  readonly url: string;
}

export interface XiangwoOpenUrlInputError {
  readonly ok: false;
  readonly message: string;
}

export type XiangwoOpenUrlInputResult = XiangwoOpenUrlInputOk | XiangwoOpenUrlInputError;

/** 球的「待开页」输入 → 可直接交给内嵌浏览器的绝对 URL；非法带回中文原因。 */
export function resolveXiangwoOpenUrlInput(raw: string): XiangwoOpenUrlInputResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, message: '请输入网址（例如 https://example.com）' };

  const scheme = XG_URL_SCHEME_RE.exec(trimmed)?.[1];
  let candidate = trimmed;
  if (scheme === undefined) {
    candidate = `https://${trimmed}`;
  } else if (!XG_HTTP_SCHEME_RE.test(scheme)) {
    if (XG_PORT_ONLY_RE.test(trimmed.slice(scheme.length + 1))) {
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

  if (!XG_HTTP_SCHEME_RE.test(parsed.protocol.replace(/:$/, ''))) {
    return { ok: false, message: '只支持 http/https 网址' };
  }
  if (parsed.hostname === '') {
    return { ok: false, message: '网址缺少主机名（例如 https://example.com）' };
  }
  if (!isUsableXiangwoHostname(parsed.hostname)) {
    return { ok: false, message: '请输入完整网址（例如 https://example.com）' };
  }
  return { ok: true, url: parsed.toString() };
}

/** 主机名要像个主机名：带点（域名/IPv4）、或 localhost、或 [IPv6] 字面量。 */
function isUsableXiangwoHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[')) return true;
  return hostname.includes('.');
}
