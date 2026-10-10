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
 * 点击目标 **只认 `page`**（来源作品页）—— 拿不到就不开（协议：page > 拿不到就不开 > 什么都不做）。
 */
export function xiangwoImageCell(item: XiangwoImageItem, baseUrl: string): XiangwoImageCell {
  const candidates = unique([
    resolveXiangwoAssetUrl(baseUrl, item.thumb),
    resolveXiangwoAssetUrl(baseUrl, item.url),
    resolveXiangwoAssetUrl(baseUrl, item.orig),
  ]);
  const src = candidates.length > 0 ? (candidates[0] ?? '') : '';
  const retrySrc = candidates.length > 1 ? (candidates[1] ?? '') : '';
  const openUrl = resolveXiangwoAssetUrl(baseUrl, item.page);
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
 * @param openUrl 要打开的地址（`cell.openUrl`；'' = 不可点）
 * @param botId 当前 bot（开页落到该 bot 的浏览器 profile；'' = 不指定）
 * @param bridge 宿主桥（球里传 `window.electronAPI`）
 */
export function openXiangwoImageSource(
  openUrl: string,
  botId: string,
  bridge?: XiangwoImagesBridge
): void {
  if (!isHttpUrl(openUrl)) return;
  const call = bridge?.orbApi;
  if (typeof call !== 'function') return;
  const request: { url: string; bot?: string } = { url: openUrl };
  const bot = typeof botId === 'string' ? botId.trim() : '';
  if (bot !== '') request.bot = bot;
  try {
    void Promise.resolve(call('host.openEmbeddedBrowser', request)).catch(() => {
      /* 主进程没接上/调用失败：这一下点空，别的卡照常 */
    });
  } catch {
    /* 同步抛（桥烂掉）也不影响其它卡 */
  }
}

export type XiangwoImageGridOptions = {
  /** agent 基址（`resolveXiangwoChatUrl` 的 baseUrl；'' = 还没解析出来） */
  baseUrl?: string;
  /** 当前 bot（点开来源页时带上，落到该 bot 的浏览器 profile） */
  botId?: string;
  bridge?: XiangwoImagesBridge;
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
      openXiangwoImageSource(cell.openUrl, options.botId ?? '', options.bridge);
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
