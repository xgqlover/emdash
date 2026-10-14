// [XG-CUSTOM 2026-10-10] **协议本体与语义已搬到 `@emdash/shared`**（球 + 主聊天窗共用一份，
//   唯一事实源 = `packages/shared/src/xiangwo-images.ts`）。本文件只保留**球专属的渲染层**
//   （cells / 网格 / 点开来源页 / agent 基址拼接）。
// ⚠️ `import` 是给下面渲染层用的；`export { … } from` 是**兼容面** —— `orb.js` 与
//   `xiangwo-images.test.ts` / `xiangwo-images-legacy.test.ts` 都从本模块 import 这些名字，
//   **不许改它们** ⇒ 导出面必须保持不变（内部换实现、对外同一副面孔）。
// [XG-CUSTOM 2026-10-10] 注意：`export { … } from` **不产生本地绑定** —— 本文件内部还要用这两个类型，
//   所以必须**同时** import（一次 import、一次 re-export，互不冲突）。
import {
  badgeOf,
  captionOf,
  isAddressLike,
  isHttpUrl,
  unique,
  type XiangwoImageItem,
  type XiangwoImagesPayload,
} from '@emdash/shared';
// [XG-CUSTOM] 图片协议 **xiangwo-images** 的解析 + 网格渲染（项我球面板）。
//
// 协议（见 orb.js 文件头 6.1；agent 侧生成见 xiangwo-agent/agent.py 的 xiangwo_images_block）：
//   ```xiangwo-images
//   {"title":"…","images":[{"url":"…","thumb":"…","alt":"…","source":"searxng",
//     "page":"<来源作品页>","orig":"<原始图片地址>"}]}
//   ```
//
// 两件事必须做对（都是实测暴露出来的）：
//   ① **相对地址**：图搜工具给的 `url`/`thumb` 可能是 agent 自己的相对路径
//      （`/xg/img?u=https%3A%2F%2F…`，第三方 CDN 直链会被防盗链/签名过期干掉），
//      所以要按 **agent 基址**（`resolveXiangwoChatUrl` 的 `baseUrl`，见 xiangwo-chat.ts）拼绝对；
//      拼不出来 → 该卡「图片不可用」占位，**绝不让整个网格崩**。
//   ② **点击行为**：整卡可点 → 在 emdash **内嵌浏览器**里打开 `page`（来源作品页）；
//      没有 `page` 就不开（也不悄悄开系统浏览器）。走的是主进程 `host.openEmbeddedBrowser`
//      （main/host/xiangwo-orb-api.ts → wiring 的 requestEmbeddedBrowserOpen → 广播
//      `open-in-embedded-browser` → 主窗口的 openEmbeddedBrowserTab，即同一条「从零开页」通道）。
//
// 和 xiangwo-chat.ts 同理放在 TS 里：DOM 由调用方传进来（球传 `document`，单测传 jsdom 的
// document），纯逻辑 + DOM 都能被 vitest 直接断言（见 xiangwo-images.test.ts）。
import { resolveXiangwoAssetUrl } from './xiangwo-chat';
export {
  XIANGWO_IMAGES_BLOCK_RE,
  XIANGWO_IMAGES_LEGACY_RE,
  XIANGWO_IMAGES_MAX,
  XIANGWO_IMAGES_STORE_MAX,
  XIANGWO_IMAGES_TITLE_MAX,
  compactXiangwoImagesBlock,
  normalizeXiangwoImages,
  parseXiangwoImagesBlock,
  type XiangwoImageItem,
  type XiangwoImagesPayload,
} from '@emdash/shared';

/**
 * 一个格子的渲染计划（纯数据，DOM 无关 → 可单测）。
 * `src` 为空 = 拼不出图片地址（没有 base / 地址坏掉）→ 直接渲染「文字 + 域名」占位。
 */
export type XiangwoImageCell = {
  /** 已拼成绝对的图片地址（'' = 画不出图） */
  src: string;
  /** 加载失败后再试一次的地址（'' = 没有） */
  retrySrc: string;
  alt: string;
  /** 卡下方小字（alt 优先，否则 source） */
  caption: string;
  /** 角上角标：`page` 的 host，取不到用 `source` */
  domain: string;
  /** `title` 属性 = 完整 URL（优先可点开的那条） */
  titleAttr: string;
  /** 点击要打开的地址（'' = 不可点，卡片不给手型） */
  openUrl: string;
  /** 没有可用图片地址（只能显示文字 + 域名） */
  textOnly: boolean;
};

/** 点击卡片时要用的桥（球里就是 `window.electronAPI` 的结构子集） */
export type XiangwoImagesBridge = {
  orbApi?: (method: string, args?: unknown) => unknown;
};

// [XG-CUSTOM 2026-10-10] 原来的 asRecord/text/isHttpUrl/isAddressLike/hostOf/unique 与
// normalizeXiangwoImages/parseXiangwoImagesBlock/compactXiangwoImagesBlock **已搬到**
// `@emdash/shared`（见文件头注释）；下面只剩球专属的渲染层。

/** 这份 payload 里有没有"必须靠 agent 基址才拼得出来"的地址（相对路径） */
function needsAgentBase(payload: XiangwoImagesPayload): boolean {
  return payload.images.some((item) =>
    [item.url, item.thumb, item.orig, item.page].some(
      (value) => value !== '' && !isHttpUrl(value) && isAddressLike(value)
    )
  );
}

/**
 * 把一条图片变成渲染计划（纯函数）：
 * 图片源优先级 `thumb > url > orig`（第一个加载不出来就试下一个）；
 * 点击目标 = **`page`（来源作品页）→ `orig`（图片原始地址）→ 都没有才不挂点击**。
 * [XG-CUSTOM 2026-10-14] 原协议是「只认 page、拿不到就不开」⇒ 真机反馈「点了没反应」⇒ 已加 `orig` 兜底。
 */
export function xiangwoImageCell(item: XiangwoImageItem, baseUrl: string): XiangwoImageCell {
  const candidates = unique([
    resolveXiangwoAssetUrl(baseUrl, item.thumb),
    resolveXiangwoAssetUrl(baseUrl, item.url),
    resolveXiangwoAssetUrl(baseUrl, item.orig),
  ]);
  const src = candidates.length > 0 ? (candidates[0] ?? '') : '';
  const retrySrc = candidates.length > 1 ? (candidates[1] ?? '') : '';
  // [XG-CUSTOM 2026-10-14] ★ **点击目标的兜底顺序（真机两次反馈后定稿）**：
  //   ① `page`（来源作品页）→ ② `orig` 原文 → ③ **从 `/xg/img?u=…` 里解出原始地址**。
  //   背景：原协议**只认 `page`**，拿不到就连 click 都不挂 ⇒ 用户「点了没反应」（第一次反馈）。
  //   加了 `orig` 兜底后仍不对：兜底重建出来的块**没有 `orig`** ⇒ 落到 `url`（`/xg/img?u=…` 代理形）
  //   ⇒ 打开的是我们自己的代理 ⇒ 死链把 agent 的 `{"error":…,"status":404}` JSON 怼给用户（第二次反馈）。
  //   ⇒ 定稿：点击**一律交给浏览器取原始地址**，不再经我们的代理；`page` 优先（那是作品页）。
  //   注：`resolveXiangwoAssetUrl` 对 http(s) 是**原样返回**（`xiangwo-chat.ts:101`），不代理化 —— 别再把锅算它头上。
  const unproxy = (raw: unknown): string => {
    const t = String(raw ?? '');
    const m = /[?&]u=([^&]+)/.exec(t);
    if (m === null || !t.includes('/xg/img?')) return '';
    try {
      return decodeURIComponent(m[1] ?? '');
    } catch {
      return '';
    }
  };
  const rawOrig = unproxy(item.orig) || String(item.orig ?? '');
  const openUrl =
    resolveXiangwoAssetUrl(baseUrl, item.page) ||
    (/^https?:\/\//i.test(rawOrig) ? rawOrig : '') ||
    unproxy(item.url);
  const fallbackAddress = src !== '' ? src : resolveXiangwoAssetUrl(baseUrl, item.url);
  return {
    src,
    retrySrc,
    alt: item.alt,
    // [XG-CUSTOM 2026-10-10] 小字 / 角标改用**共享语义**（`captionOf` / `badgeOf`）——
    // 与主聊天窗同一个口径；角标传 `openUrl`（已按 agent 基址拼好），保持原来"拼后取 host"的行为。
    caption: captionOf(item),
    domain: badgeOf(item, openUrl),
    titleAttr: openUrl !== '' ? openUrl : fallbackAddress,
    openUrl,
    textOnly: src === '',
  };
}

/** 一份 payload 的全部渲染计划（顺序 = 网格顺序） */
export function xiangwoImageCells(payload: XiangwoImagesPayload, baseUrl = ''): XiangwoImageCell[] {
  return payload.images.map((item) => xiangwoImageCell(item, baseUrl));
}

/**
 * 一张图加载失败后怎么走：第一次失败 → 换下一个候选地址重试；再失败（或没有候选）→ 退化。
 * 每次只作用于**这一张卡**自己的状态（调用方按卡保存 `triedRetry`），别的卡不受影响。
 */
export function xiangwoImageErrorAction(
  cell: XiangwoImageCell,
  triedRetry: boolean
): { action: 'retry'; src: string } | { action: 'degrade' } {
  if (!triedRetry && cell.retrySrc !== '' && cell.retrySrc !== cell.src) {
    return { action: 'retry', src: cell.retrySrc };
  }
  return { action: 'degrade' };
}

/**
 * 点卡片 → 在 emdash **内嵌浏览器**里打开来源作品页。
 *
 * 走主进程的 `host.openEmbeddedBrowser`（见 main/host/xiangwo-orb-api.ts）：它把请求接回
 * 「从零开页」广播（`browserEvents` 的 `open-in-embedded-browser`），由主窗口渲染进程的
 * `openEmbeddedBrowserTab`（core/features/workbench/api/browser/embedded-browser-open-request.ts）
 * 真的开一个内嵌浏览器标签页 —— 与 agent 的 9223 桥 / 反向通道**同一条**通道，不另造机制。
 *
 * 不是 http(s) / 桥不可用 / 调不通 → **什么都不做**（不悄悄开系统浏览器、绝不离开球面板）。
 *
 * [XG-CUSTOM 2026-10-12] **失败不再静默**：主进程现在会等主窗口渲染进程的**真实回执**
 * （`{ok:false, reason}`，见 main/host/browser/embedded-browser-open-ack.ts），拿到就调
 * `onFailure`（球里用它显示一行 `transcript-action-notice` 人话回执 —— 文案由
 * `xiangwoOpenFailureNotice` 生成，`reason` 原样带出）。**成功不回调**（不打扰用户）。
 *
 * @param openUrl 要打开的地址（`cell.openUrl`；'' = 不可点）
 * @param botId 当前 bot（开页落到该 bot 的浏览器 profile；'' = 不指定）
 * @param bridge 宿主桥（球里传 `window.electronAPI`）
 * @param onFailure 失败回执（不传 = 什么都不做，老调用方零回归）
 */
export function openXiangwoImageSource(
  openUrl: string,
  botId: string,
  bridge?: XiangwoImagesBridge,
  onFailure?: (result: XiangwoOpenSourceResult) => void
): void {
  if (!isHttpUrl(openUrl)) return;
  const call = bridge?.orbApi;
  if (typeof call !== 'function') {
    // 桥没接上（球窗口的 preload 异常）：以前是完全静默的一下"点空"，现在如实说一句
    onFailure?.({ ok: false, reason: 'unavailable' });
    return;
  }
  const request: { url: string; bot?: string } = { url: openUrl };
  const bot = typeof botId === 'string' ? botId.trim() : '';
  if (bot !== '') request.bot = bot;
  // [XG-CUSTOM 2026-10-14] **A 打底**：内嵌开页开不了（没工作区/没 task/通道没接上/开失败）时，
  //   退到 emdash **原生**的「交给系统默认浏览器」（`host.openExternal`，本文件上方协议里的 B 增强在前面）。
  //   为什么：真机两次反馈「点了没反应」——内嵌那条路要求"停在 task 视图且有 task"（`no-task`/`no-task-view`），
  //   而系统浏览器**不依赖工作区**、永远可用；只挂一行小字提示等于还是"没反应"。
  const openedExternal = (reason: string): void => {
    void Promise.resolve(call('host.openExternal', { url: openUrl }))
      .then((r2) => {
        const ok2 =
          typeof r2 === 'object' && r2 !== null && (r2 as Record<string, unknown>).ok === true;
        onFailure?.({ ok: false, reason: ok2 ? 'opened-external' : reason });
      })
      .catch(() => onFailure?.({ ok: false, reason }));
  };
  try {
    void Promise.resolve(call('host.openEmbeddedBrowser', request))
      .then((raw) => {
        // 主进程回来的形状：{ok:true} / {ok:false, reason}（未知方法/null 也算失败 —— 不许假装开好了）
        const record =
          typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
        if (record.ok === true) return;
        openedExternal(typeof record.reason === 'string' ? record.reason : 'failed');
      })
      .catch(() => openedExternal('unavailable'));
  } catch {
    openedExternal('unavailable');
  }
}

/** 开页结果（主进程原样回的：成功 `{ok:true}` / 失败 `{ok:false, reason}`） */
export type XiangwoOpenSourceResult = { ok: boolean; reason?: string };

/** 已知原因码 → 一句人话（**不粉饰**：没开就说没开，并能说清是哪一种没开） */
const OPEN_FAILURE_TEXT: Record<string, string> = {
  'no-task': 'emdash 里一个任务都没有 —— 内嵌浏览器页得挂在任务下面，所以我没开',
  'no-task-view': '目标是找到了，但那个任务的界面还没准备好（可能还在创建），所以我没开',
  unavailable: '球的这条开页通道没接上（球连不上主界面），所以我没开',
  timeout: '主界面没回话（开页那条广播没人接），所以我没确认开成',
  'bad-url': '这个地址不是 http(s) 开头（或者为空），所以我没开',
  failed: '内嵌浏览器没开成',
  // [XG-CUSTOM 2026-10-14] A 打底生效：内嵌没开成，但**已经用系统浏览器打开了**（如实说，不假装没开）
  'opened-external': '内嵌浏览器开不了（没有可挂的任务），已改用**系统浏览器**打开',
};

/**
 * agent 本机地址（`127.0.0.1` / `localhost` / `::1`）—— **只提示，不改写**。
 * [XG-CUSTOM 2026-10-12] 口径（用户定的）：Linux 上 agent 与本机浏览器同机，这种地址**能开**；
 * 而 Windows 客户端上的 emdash 去打 `127.0.0.1` 打到的是**它自己那台机器** ⇒ 开不出来。
 * 我们**不改写 URL**（改写会让 Linux 本机那条反而坏），只在回执里提示一句。
 */
export function isAgentLocalAddress(url: string): boolean {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  if (match === null) return false;
  const hostPort = match[1] ?? '';
  const host = (hostPort.startsWith('[') ? hostPort.slice(1, hostPort.indexOf(']')) : hostPort.split(':')[0] ?? '')
    .trim()
    .toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
}

/**
 * 开页失败 → 给用户看的**一行**人话回执（纯函数，可离线单测）。
 *   · 成功 → `''`（成功不吵）
 *   · **原因码原样带出**（`（原因：no-task）`）—— 别把它翻译没了，排障就靠它
 *   · agent 本机地址（127.0.0.1 / localhost）**只加一句提示、不改写 URL**（R7 兜底）
 */
export function xiangwoOpenFailureNotice(result: XiangwoOpenSourceResult, url = ''): string {
  if (result.ok === true) return '';
  const reason = typeof result.reason === 'string' && result.reason !== '' ? result.reason : 'failed';
  const text = OPEN_FAILURE_TEXT[reason] ?? '内嵌浏览器没开成';
  const hint = isAgentLocalAddress(url)
    ? '（另外：这条是 agent 本机地址，远端那台机器上可能打不开。）'
    : '';
  return `${text}（原因：${reason}）${hint}`;
}

export type XiangwoImageGridOptions = {
  /** agent 基址（`resolveXiangwoChatUrl` 的 baseUrl；'' = 还没解析出来） */
  baseUrl?: string;
  /** 当前 bot（点开来源页时带上，落到该 bot 的浏览器 profile） */
  botId?: string;
  bridge?: XiangwoImagesBridge;
  /**
   * [XG-CUSTOM 2026-10-12] 整卡点击**开页失败**的回执（球里用它显示一行
   * `transcript-action-notice`；不传 = 不显示，老调用方零回归）。
   * 文案由 `xiangwoOpenFailureNotice(result, cell.openUrl)` 生成。
   */
  onOpenFailure?: (result: XiangwoOpenSourceResult, url: string) => void;
};

function renderCell(
  doc: Document,
  cell: XiangwoImageCell,
  options: XiangwoImageGridOptions
): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className =
    cell.openUrl === '' ? 'image-cell image-cell-static' : 'image-cell image-cell-clickable';
  button.title = cell.titleAttr;

  // 说明文字（alt 优先，否则 source）先建好：加载失败的占位要插在它前面（观感跟正常格子一致）
  const captionEl = cell.caption === '' ? null : doc.createElement('span');
  if (captionEl !== null) {
    captionEl.className = 'image-caption';
    captionEl.textContent = cell.caption;
  }

  /** 退化占位：一行文案 + 完整地址（和 caption / 域名角标一起就是"文字 + 域名"卡） */
  const fallbackOf = (label: string): HTMLElement => {
    const fallback = doc.createElement('div');
    fallback.className = 'image-fallback';
    const textEl = doc.createElement('span');
    textEl.className = 'image-fallback-text';
    textEl.textContent = label;
    const urlEl = doc.createElement('span');
    urlEl.className = 'image-fallback-url';
    urlEl.textContent = cell.titleAttr !== '' ? cell.titleAttr : cell.domain;
    fallback.append(textEl, urlEl);
    return fallback;
  };

  if (cell.src === '') {
    // [XG-CUSTOM] 没有 agent 基址（或地址坏掉）→ 直接"图片不可用"，**不崩整个网格**
    button.append(fallbackOf('图片不可用'));
    button.classList.add('failed');
  } else {
    const image = doc.createElement('img');
    image.className = 'image-thumb';
    image.src = cell.src;
    image.alt = cell.alt;
    // 用 setAttribute 写（不靠属性反射）：DOM 上一定能看到这两个事实，自检也能直接断言
    image.setAttribute('loading', 'lazy');
    // 防盗链：不带 referrer 更容易把图加载出来（和 soutu_toolset 生成的 HTML 一致）
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.setAttribute('decoding', 'async');

    // 每张卡**各存各的**重试状态：一张图挂了只退化它自己
    let triedRetry = false;
    image.addEventListener('error', () => {
      const next = xiangwoImageErrorAction(cell, triedRetry);
      if (next.action === 'retry') {
        triedRetry = true;
        image.src = next.src; // 缩略图/代理挂了 → 换下一个候选（原图）再试一次
        return;
      }
      if (button.querySelector('.image-fallback') !== null) return;
      // 不能用 image.hidden —— .image-thumb 的 `display:block`（作者样式）会盖掉 UA 的
      // [hidden]{display:none}，破图图标和 alt 文字还会杵在那儿（真机截图抓到的）
      image.style.display = 'none';
      const fallback = fallbackOf('图片加载失败');
      if (captionEl === null) button.append(fallback);
      else button.insertBefore(fallback, captionEl);
      button.classList.add('failed');
    });
    button.append(image);
  }
  if (captionEl !== null) button.append(captionEl);

  // 角上角标：来源域名（page 的 host，取不到用 source）
  if (cell.domain !== '') {
    const domain = doc.createElement('span');
    domain.className = 'image-domain';
    domain.textContent = cell.domain;
    button.append(domain);
  }
  if (cell.openUrl !== '') {
    button.addEventListener('click', () => {
      // [XG-CUSTOM 2026-10-12] 开页失败要有回执（以前是"点一下，没反应，也没日志"）
      openXiangwoImageSource(cell.openUrl, options.botId ?? '', options.bridge, (result) => {
        options.onOpenFailure?.(result, cell.openUrl);
      });
    });
  }
  return button;
}

/**
 * 渲染图片网格（协议见文件头）：标题 + 每格一张图（角度带来源域名角标，整卡可点开来源页）。
 * `baseUrl` 为空但 payload 里有相对地址时，网格会带 `image-grid-needs-base` 类 ——
 * 球收到基址后据此重画（见 orb.js 的 applyAgentBaseUrl）。
 * @param doc 宿主 document（球传 `document`；单测传 jsdom 的 document）
 */
export function renderXiangwoImageGrid(
  doc: Document,
  payload: XiangwoImagesPayload,
  options: XiangwoImageGridOptions = {}
): HTMLElement {
  const wrap = doc.createElement('div');
  wrap.className = 'image-grid-wrap';
  if (payload.title !== '') {
    const title = doc.createElement('div');
    title.className = 'image-grid-title';
    title.textContent = payload.title;
    wrap.append(title);
  }
  const grid = doc.createElement('div');
  grid.className = 'image-grid';
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '';
  if (baseUrl === '' && needsAgentBase(payload)) grid.classList.add('image-grid-needs-base');
  for (const cell of xiangwoImageCells(payload, baseUrl)) {
    grid.append(renderCell(doc, cell, options));
  }
  wrap.append(grid);
  return wrap;
}
