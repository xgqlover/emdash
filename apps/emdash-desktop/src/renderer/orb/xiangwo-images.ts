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

/** 协议上限：一次最多 60 条（**别放宽**，agent 侧同一个数） */
export const XIANGWO_IMAGES_MAX = 60;
/** title 上限（字符） */
export const XIANGWO_IMAGES_TITLE_MAX = 200;
/** 历史落盘只留前 24 条（不落 dataURL，见 orb.js 的 persistConversations） */
export const XIANGWO_IMAGES_STORE_MAX = 24;

/** 图片块的正则（单独成段的 fenced JSON） */
export const XIANGWO_IMAGES_BLOCK_RE = /```xiangwo-images\s*([\s\S]*?)```/;
// [XG-CUSTOM 2026-10-06] **旧标记兼容**：agent 的推图老路径发的是 `[XG-IMG]<地址>[/XG-IMG]`，
//   球此前只认上面的围栏块 ⇒ 旧标记**认不出、以原始文本裸露在对话里**（用户实际撞到过）。
//   现在两条都认（旧标记按"一条地址一张图"归一），认不出也**至少剥掉**、不裸露。
export const XIANGWO_IMAGES_LEGACY_RE = /\[XG-IMG\]([\s\S]*?)\[\/XG-IMG\]/g;

/** 归一化后的一条图片 */
export type XiangwoImageItem = {
  /** 图片地址（绝对 http(s) 或 agent 相对路径；'' = 这一条只给得出来源页） */
  url: string;
  thumb: string;
  alt: string;
  /** 来源标识（searxng|web|zcool|pixelrag…） */
  source: string;
  /** 来源作品页（点开就开它；http(s) 或 agent 相对路径） */
  page: string;
  /** 原始图片地址（thumb/url 都加载不出来时的最后一次重试） */
  orig: string;
};

export type XiangwoImagesPayload = { title: string; images: XiangwoImageItem[] };

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 0): string {
  const result = typeof value === 'string' ? value.trim() : '';
  return max > 0 ? result.slice(0, max) : result;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** 能用 agent 基址拼成绝对 URL 的地址：http(s) / 协议相对 `//h/x` / 相对路径 `/x` */
function isAddressLike(value: string): boolean {
  return isHttpUrl(value) || value.startsWith('//') || value.startsWith('/');
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** 去重（保序），顺带丢掉空串 */
function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) if (value !== '' && !out.includes(value)) out.push(value);
  return out;
}

/**
 * 归一化一份图片 payload。每条至少要有 `url`/`orig`/`page` 之一（否则丢掉）；
 * 相对地址**保留原样**（渲染时按当时的 agent 基址拼绝对，历史里存的就是相对路径）。
 * 一条都不剩 → undefined（调用方据此把整段当普通文本，绝不吞消息）。
 * @param raw JSON.parse 后的对象
 */
export function normalizeXiangwoImages(raw: unknown): XiangwoImagesPayload | undefined {
  const record = asRecord(raw);
  const list = Array.isArray(record.images) ? record.images : [];
  const images: XiangwoImageItem[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    const url = text(item.url);
    const thumb = text(item.thumb);
    const orig = text(item.orig);
    const page = text(item.page);
    if (!isAddressLike(url) && !isAddressLike(orig) && !isAddressLike(page)) continue;
    images.push({
      url: isAddressLike(url) ? url : '',
      thumb: isAddressLike(thumb) ? thumb : '',
      alt: text(item.alt, 200),
      source: text(item.source, 60),
      page: isAddressLike(page) ? page : '',
      orig: isAddressLike(orig) ? orig : '',
    });
    if (images.length >= XIANGWO_IMAGES_MAX) break; // 协议上限：≤60 条
  }
  if (images.length === 0) return undefined;
  return { title: text(record.title, XIANGWO_IMAGES_TITLE_MAX), images };
}

/**
 * 解析回复里的图片网格块（协议见文件头）。
 * 找不到 / JSON 坏了 / 一条合法地址都没有 → 原样返回文本、images = undefined（绝不吞消息）。
 */
export function parseXiangwoImagesBlock(textValue: unknown): {
  text: string;
  images?: XiangwoImagesPayload;
} {
  const source = typeof textValue === 'string' ? textValue : '';
  let text = source;
  let payload: XiangwoImagesPayload | undefined;

  // ① 优先围栏块（现行协议）
  const match = XIANGWO_IMAGES_BLOCK_RE.exec(text);
  if (match !== null) {
    try {
      payload = normalizeXiangwoImages(JSON.parse(match[1].trim()));
    } catch {
      payload = undefined;
    }
    // 归一成功才剥。**既有契约**（见 xiangwo-images.test.ts「坏 JSON 不吞消息」）：
    // 坏 JSON / 全非法项 → 块留在正文里，别把用户的内容悄悄吞掉；
    // 而下面的 `[XG-IMG]` 旧标记**一律剥** —— 那是机器标记，用户不该看到（本次修的就是它）。
    if (payload !== undefined) text = text.replace(match[0], '');
  }

  // ② [XG-CUSTOM 2026-10-06] 旧标记 `[XG-IMG]<地址>[/XG-IMG]`：收成"一条地址一张图"。
  //    ★无论能不能归一，**都要从正文里剥掉** —— 绝不把原始标记显示给用户。
  const legacy: string[] = [];
  for (const m of text.matchAll(XIANGWO_IMAGES_LEGACY_RE)) {
    const raw = (m[1] ?? '').trim();
    if (raw !== '') legacy.push(raw);
  }
  // ★空标记也要剥（`[XG-IMG][/XG-IMG]` 不留残渣）；payload 的键是 **images**（见 XiangwoImagesPayload）
  text = text.replace(XIANGWO_IMAGES_LEGACY_RE, '');
  if (payload === undefined && legacy.length > 0) {
    payload = normalizeXiangwoImages({ images: legacy.map((url) => ({ url })) });
  }

  return payload === undefined ? { text: text.trim() } : { text: text.trim(), images: payload };
}

/**
 * 历史落盘时压缩图片块：只留前 `max` 条地址（**不落 dataURL**；相对地址原样保留，
 * 下次渲染时按当时的 agent 基址再拼）。压不了/不需要压 → 原样返回（绝不改坏别的文本）。
 */
export function compactXiangwoImagesBlock(
  textValue: unknown,
  max = XIANGWO_IMAGES_STORE_MAX
): string {
  const source = typeof textValue === 'string' ? textValue : '';
  if (!source.includes('```xiangwo-images')) return source;
  const match = XIANGWO_IMAGES_BLOCK_RE.exec(source);
  if (match === null) return source;
  try {
    const payload = normalizeXiangwoImages(JSON.parse(match[1].trim()));
    if (payload === undefined || payload.images.length <= max) return source;
    const stored: { title?: string; images: XiangwoImageItem[] } = {
      images: payload.images.slice(0, max),
    };
    if (payload.title !== '') stored.title = payload.title;
    return source.replace(match[0], '```xiangwo-images\n' + JSON.stringify(stored) + '\n```');
  } catch {
    return source;
  }
}

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
  const host = hostOf(openUrl);
  const fallbackAddress = src !== '' ? src : resolveXiangwoAssetUrl(baseUrl, item.url);
  return {
    src,
    retrySrc,
    alt: item.alt,
    caption: item.alt !== '' ? item.alt : item.source,
    domain: host !== '' ? host : item.source,
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
