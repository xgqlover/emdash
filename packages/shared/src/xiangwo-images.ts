// [XG-CUSTOM 2026-10-10] 图片协议 **xiangwo-images** 与语义的**唯一事实源**（球 + 主聊天窗共用一份）。
//
// 为什么在这里：球（`apps/emdash-desktop/src/renderer/orb/`）与主聊天窗
// （`packages/chat-ui/src/components/rows/message/`）是**同一个产品的两个面**
// （球 = emdash 的助手面）。协议一度在**三处**各写一份（球 TS / 主窗 TS / 桥 Python），
// 已经因为"每层各写一份"出过两次真机事故。桥是 Python，共享不了；**两个 TS 面必须共用一份**。
//
//   协议本体（围栏块 ```` ```xiangwo-images ````）—— 球面直接消费；agent 侧生成见
//     `xiangwo-agent/agent.py::xiangwo_images_block`。
//   ACP 变体（`[XG-IMG-META]<json>[/XG-IMG-META]` 文本 marker + base64 图片块）—— 主聊天窗面消费；
//     桥侧生成见 `xiangwo_acp.py`（跨机只能走字节，所以图片本身走 ACP image 块，元数据走这条 marker）。
//
// 各面**各自保留**渲染：球是内联 DOM 网格（`orb/xiangwo-images.ts` 的 cells/render），
// 主窗是虚拟列表里固定格子的网格（`chat-ui/.../assistant-images.ts` 的几何）。这里只放纯逻辑。
//
// ⚠️ 本模块**只用语言内建** —— 它会被打进渲染层 bundle，不许 import node/pino/zod。

/** 协议上限：一次最多 60 条（**别放宽**，agent 侧同一个数） */
export const XIANGWO_IMAGES_MAX = 60;
/** title 上限（字符） */
export const XIANGWO_IMAGES_TITLE_MAX = 200;
/** 历史落盘只留前 24 条（不落 dataURL，见 orb.js 的 persistConversations） */
export const XIANGWO_IMAGES_STORE_MAX = 24;

/** 图片块的正则（单独成段的 fenced JSON） */
export const XIANGWO_IMAGES_BLOCK_RE = /```xiangwo-images\s*([\s\S]*?)```/;

// [XG-CUSTOM 2026-10-06] **旧标记兼容**：agent 的推图老路径发的是 `[XG-IMG]<地址>[/XG-IMG]`，
//   球此前只认围栏块 ⇒ 旧标记**认不出、以原始文本裸露在对话里**（用户实际撞到过）。
//   现在两条都认（旧标记按"一条地址一张图"归一），认不出也**至少剥掉**、不裸露。
export const XIANGWO_IMAGES_LEGACY_RE = /\[XG-IMG\]([\s\S]*?)\[\/XG-IMG\]/g;

/** ACP 变体的元数据 marker（主聊天窗面；桥把它作为**一条文本块**下发） */
export const XG_IMG_META_OPEN = '[XG-IMG-META]';
export const XG_IMG_META_CLOSE = '[/XG-IMG-META]';
/** marker 里 alt / source 的上限（与主窗原来那份逐字一致） */
export const XG_IMG_META_MAX_ALT = 200;
export const XG_IMG_META_MAX_SOURCE = 80;

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

/** ACP marker 里的一条（主聊天窗面；与图片**按位配对**） */
export type XiangwoImageMeta = {
  alt: string;
  source: string;
  page: string;
};

/** `captionOf` / `badgeOf` 只看这三个字段，所以两面的 item / meta 都能直接传进来 */
export type XiangwoImageLike = {
  alt?: string;
  source?: string;
  page?: string;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown, max = 0): string {
  const result = typeof value === 'string' ? value.trim() : '';
  return max > 0 ? result.slice(0, max) : result;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** 能用 agent 基址拼成绝对 URL 的地址：http(s) / 协议相对 `//h/x` / 相对路径 `/x` */
export function isAddressLike(value: string): boolean {
  return isHttpUrl(value) || value.startsWith('//') || value.startsWith('/');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** 去重（保序），顺带丢掉空串 */
export function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) if (value !== '' && !out.includes(value)) out.push(value);
  return out;
}

/**
 * [XG-CUSTOM 2026-10-10] **共享语义①**：卡下方小字 = `alt` 优先，否则 `source`。
 * 两面必须一致（球：`xiangwoImageCell`；主窗：`buildAssistantImages`）。
 */
export function captionOf(item: XiangwoImageLike): string {
  const alt = text(item.alt);
  const source = text(item.source);
  return alt !== '' ? alt : source;
}

/**
 * [XG-CUSTOM 2026-10-10] **共享语义②**：角上角标 = `page` 的 host，取不到用 `source`。
 *
 * `resolvedPage` 给"已经把 page 拼成绝对地址"的调用方用（球：相对 page 要先按 agent 基址拼，
 * 拼出来的 host 才是角标该显示的东西）；不传就用 `item.page` 原样（主窗：page 本来就是绝对 URL）。
 */
export function badgeOf(item: XiangwoImageLike, resolvedPage = ''): string {
  const page = text(resolvedPage) !== '' ? text(resolvedPage) : text(item.page);
  const host = hostOf(page);
  return host !== '' ? host : text(item.source);
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

  // ② 旧标记 `[XG-IMG]<地址>[/XG-IMG]`：收成"一条地址一张图"。
  //    ★无论能不能归一，**都要从正文里剥掉** —— 绝不把原始标记显示给用户。
  const legacy: string[] = [];
  for (const m of text.matchAll(XIANGWO_IMAGES_LEGACY_RE)) {
    const raw = (m[1] ?? '').trim();
    if (raw !== '') legacy.push(raw);
  }
  // ★空标记也要剥（`[XG-IMG][/XG-IMG]` 不留残渣）；payload 的键是 **images**
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

/** 把常量拼成正则源码（`[` 之类要转义；`-` 在 JS 正则里不算元字符，保持原样） */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `[XG-IMG-META]<json>[/XG-IMG-META]` 的正则源码（**每次调用现建**，不共享 `/g` 状态） */
export const XG_IMG_META_RE_SOURCE = `${escapeRe(XG_IMG_META_OPEN)}([\\s\\S]*?)${escapeRe(XG_IMG_META_CLOSE)}`;

/**
 * [XG-CUSTOM 2026-10-10] 解析 ACP 变体的元数据 marker（主聊天窗面）。
 *
 * marker **无条件剥掉**（机器数据，用户不该看到）；`meta` 只在载荷是 JSON 数组时才有内容，
 * 坏 JSON / 非数组 / 缺字段**只降级不抛**（这是原来那份的既有契约，行为逐字保持）。
 */
export function splitXiangwoImageMeta(textValue: unknown): {
  text: string;
  meta: XiangwoImageMeta[];
} {
  const source = typeof textValue === 'string' ? textValue : '';
  const re = new RegExp(XG_IMG_META_RE_SOURCE, 'g');
  const meta: XiangwoImageMeta[] = [];
  for (const match of source.matchAll(re)) {
    const raw = (match[1] ?? '').trim();
    if (raw === '') continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const item = asRecord(entry);
        meta.push({
          alt: text(item.alt, XG_IMG_META_MAX_ALT),
          source: text(item.source, XG_IMG_META_MAX_SOURCE),
          page: text(item.page),
        });
      }
    } catch {
      // Broken JSON: the marker is still stripped above — nothing else to do.
    }
  }
  return { text: source.replace(re, '').trim(), meta };
}
