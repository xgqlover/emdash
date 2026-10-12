// [XG-CUSTOM 2026-10-12] 球的「待发图片」队列验收（见 ./orb-attachments.ts 的文件头）。
//
// 四件事必须钉住（前两件是用户直接要的行为，后两件是"别把用户的东西弄丢 / 别静默"）：
//   ① 图**不再立刻发**：入队后队列里有它，`planSend` 才产出出站消息；
//   ② 文字**跟图一起走**：一条带字 + 一张图 ⇒ 一个出站消息里 text 与 image 都在；
//   ③ 满了/重复**不静默丢**（重复去重、满员时原样返回 ⇒ 调用方给提示）；
//   ④ 什么都没给 ⇒ 不出站（`[]`，绝不发空消息）。
import { describe, expect, it } from 'vitest';
import {
  addPendingImage,
  isFull,
  makePendingImageId,
  MAX_PENDING_IMAGES,
  planSend,
  removePendingImage,
  type PendingImage,
} from './orb-attachments';

function img(n: number): PendingImage {
  return {
    id: makePendingImageId(n),
    name: `shot-${String(n)}.png`,
    dataUrl: `data:image/png;base64,AAA${String(n)}`,
  };
}

describe('addPendingImage / removePendingImage：队列增删', () => {
  it('入队后拿得到（图**不会**立刻发出去）', () => {
    const list = addPendingImage([], img(1));
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('shot-1.png');
  });

  it('同一张图粘两次 ⇒ 只留一张（按 dataUrl 去重）', () => {
    const one = addPendingImage([], img(1));
    expect(addPendingImage(one, img(1))).toHaveLength(1);
  });

  it('满员 ⇒ 原样返回（**不悄悄挤掉**最早那张）', () => {
    let list: PendingImage[] = [];
    for (let i = 0; i < MAX_PENDING_IMAGES; i += 1) list = addPendingImage(list, img(i));
    expect(isFull(list)).toBe(true);
    const over = addPendingImage(list, img(99));
    expect(over).toHaveLength(MAX_PENDING_IMAGES);
    expect(over.map((x) => x.name)).toEqual(list.map((x) => x.name));
  });

  it('按 id 删除；删不存在的 id 不炸', () => {
    const list = addPendingImage(addPendingImage([], img(1)), img(2));
    expect(removePendingImage(list, 'att-1').map((x) => x.name)).toEqual(['shot-2.png']);
    expect(removePendingImage(list, 'nope')).toHaveLength(2);
  });

  it('不改入参（纯函数）', () => {
    const list: PendingImage[] = [];
    addPendingImage(list, img(1));
    expect(list).toHaveLength(0);
  });
});

describe('planSend：文字跟图一起发', () => {
  it('只有文字 ⇒ 一条纯文字', () => {
    expect(planSend('帮我看看这个', [])).toEqual([{ text: '帮我看看这个', image: '' }]);
  });

  it('文字 + 一张图 ⇒ **同一个**出站消息（这就是用户要的）', () => {
    const plan = planSend('照这个风格做', [img(1)]);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.text).toBe('照这个风格做');
    expect(plan[0]?.image).toBe('data:image/png;base64,AAA1');
  });

  it('文字 + 两张图 ⇒ 文字挂第一条，第二条是纯图（8900 一条只认一张图）', () => {
    const plan = planSend('照这个', [img(1), img(2)]);
    expect(plan).toEqual([
      { text: '照这个', image: 'data:image/png;base64,AAA1' },
      { text: '', image: 'data:image/png;base64,AAA2' },
    ]);
  });

  it('只有图（没打字）⇒ 纯图一条（回车也能发）', () => {
    expect(planSend('   ', [img(1)])).toEqual([{ text: '', image: 'data:image/png;base64,AAA1' }]);
  });

  it('文字两端空白会被去掉', () => {
    expect(planSend('  看这个  ', [])).toEqual([{ text: '看这个', image: '' }]);
  });

  it('什么都没有 ⇒ 不出站（绝不发空消息）', () => {
    expect(planSend('', [])).toEqual([]);
    expect(planSend('   ', [])).toEqual([]);
  });
});
