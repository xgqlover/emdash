// [XG-CUSTOM 2026-10-06] 旧标记 `[XG-IMG]…[/XG-IMG]` 兼容回归（用户报的"原始标记裸露"）。
import { describe, expect, it } from 'vitest';
import { parseXiangwoImagesBlock } from './xiangwo-images';

describe('xiangwo-images 旧标记兼容', () => {
  it('★旧标记 → 解析成图，且**从正文里剥掉**（不再裸露）', () => {
    const got = parseXiangwoImagesBlock(
      '看图\n[XG-IMG]/persistent/home/xgqlover/工作空间/sxsj/sxsj/sketch-1791000868.html.png[/XG-IMG]\n'
    );
    expect(got.text).toBe('看图');
    expect(got.text).not.toContain('[XG-IMG]');
    expect(got.images).toBeDefined();
  });

  it('★多条旧标记都收进来，正文里一个不剩', () => {
    const got = parseXiangwoImagesBlock('[XG-IMG]/a/1.png[/XG-IMG] 中间 [XG-IMG]/a/2.png[/XG-IMG]');
    expect(got.text).toBe('中间');
    expect(got.text).not.toContain('XG-IMG');
  });

  it('★空标记也剥掉（不留残渣）', () => {
    const got = parseXiangwoImagesBlock('前[XG-IMG][/XG-IMG]后');
    expect(got.text).toBe('前后');
  });

  it('围栏块与旧标记混用 → 都能处理，正文干净', () => {
    const fenced = '```xiangwo-images\n{"images":[{"url":"/p/a.png"}]}\n```';
    const got = parseXiangwoImagesBlock(fenced + '\n[XG-IMG]/p/b.png[/XG-IMG]\n尾部');
    expect(got.text).toBe('尾部');
    expect(got.images).toBeDefined();
  });

  it('没有块 → 原样返回（零副作用）', () => {
    expect(parseXiangwoImagesBlock('普通回复')).toEqual({ text: '普通回复' });
  });
});
