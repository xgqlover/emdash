/**
 * [XG-CUSTOM 2026-10-12] 球的**待发图片队列** —— 先把图攥在手里，**打完字跟图一起发**。
 *
 * 真机反馈（用户）：「在发图时能不能让我能打字跟图一起发，我一发图就自己发出去了」。
 * 旧行为（`orb.js::handleIncomingFiles`）：读到图片**立刻** `send('', dataUrl)`
 * ⇒ 图单独成一条消息、用户没机会配文字/配指令。
 *
 * 分工（照本目录惯例：判定/纯逻辑放 TS 模块 + 单测，DOM/接线留 `orb.js`）：
 *   · 本文件 = **纯函数**（队列增删 + 出站计划），零 DOM、零 Electron；
 *   · `orb.js` = 读文件成 dataURL、渲染缩略图、按计划逐条发。
 *
 * ⚠️ 图片只活在内存里（`dataURL`，既有约定）：`persistConversations()` 只落 role/text/answer，
 * 不落图 —— 本模块不改变这一点。
 */
export type PendingImage = { id: string; name: string; dataUrl: string };

/** 一条出站消息：`image` 为空串表示纯文字；`text` 可为空串（纯图）。 */
export type Outgoing = { text: string; image: string };

/** 待发上限 —— 每张都是 dataURL，攒太多会把 8900 的请求体撑爆（取 6，够用且可控）。 */
export const MAX_PENDING_IMAGES = 6;

/** 待发队列满了吗？（调用方据此给用户一句人话，而不是**静默丢图**） */
export function isFull(list: PendingImage[], limit: number = MAX_PENDING_IMAGES): boolean {
  return list.length >= limit;
}

/**
 * 入队一张图。返回**新数组**（不改入参，方便测试与回滚）。
 *
 * · **同图去重**：同一张截图粘两次不该出现两个缩略图（按 `dataUrl` 比）；
 * · **满了就原样返回**（调用方先 `isFull` 提示；这里不做"悄悄挤掉最早那张"——
 *   静默丢用户的东西是本仓最忌的一类 bug）。
 */
export function addPendingImage(
  list: PendingImage[],
  image: PendingImage,
  limit: number = MAX_PENDING_IMAGES
): PendingImage[] {
  if (isFull(list, limit)) return list;
  if (list.some((item) => item.dataUrl === image.dataUrl)) return list;
  return [...list, image];
}

/** 按 `id` 出队（找不到 ⇒ 原样返回，不抛）。 */
export function removePendingImage(list: PendingImage[], id: string): PendingImage[] {
  return list.filter((item) => item.id !== id);
}

/**
 * 把「一段文字 + N 张待发图」排成**出站计划**（顺序发送，见 `orb.js`）。
 *
 * · 文字只挂在**第一条**上（用户打的字是给这条消息的指令）；
 * · 其余每张图各成一条**纯图**消息（8900 一条用户消息只认一张图 —— 与旧行为一致：
 *   旧代码就是"每张图一条"）；
 * · 什么都没有 ⇒ `[]`（调用方据此不发）。
 */
export function planSend(text: string, images: PendingImage[]): Outgoing[] {
  const trimmed = (text ?? '').trim();
  if (images.length === 0) return trimmed === '' ? [] : [{ text: trimmed, image: '' }];
  return images.map((image, index) => ({
    text: index === 0 ? trimmed : '',
    image: image.dataUrl,
  }));
}

/** 给新入队的图造一个稳定 id（`Date.now()` + 序号；仅用于 DOM 定位与删除，无业务含义）。 */
export function makePendingImageId(seq: number): string {
  return `att-${String(seq)}`;
}
