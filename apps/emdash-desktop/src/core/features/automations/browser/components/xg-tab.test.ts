// [XG-CUSTOM 2026-10-11] 回归：Tab 取值口径（纯函数）。
// 背景：1.2.32 因为把这段判断内联进 useState 初始化器（引用了下方才声明的 params）而**整页崩**。
import { describe, expect, it } from 'vitest';
import { XG_TAB_DEFAULT, XG_TABS, isXgTab, xgTabOf } from './xg-tab';

describe('xg-tab（自动化视图的 Tab 口径）', () => {
  it('认三个合法 Tab', () => {
    expect(xgTabOf('automations')).toBe('automations');
    expect(xgTabOf('kaneo')).toBe('kaneo');
    expect(xgTabOf('workrally')).toBe('workrally');
  });

  it('认不出的值一律回落默认（从左侧栏进来时 params 没有 tab）', () => {
    for (const bad of [undefined, null, '', 'integrations', 'WorkRally', 0, 42, {}, [], true]) {
      expect(xgTabOf(bad)).toBe(XG_TAB_DEFAULT);
    }
  });

  it('isXgTab 只对合法值点头', () => {
    expect(XG_TABS.every((t) => isXgTab(t))).toBe(true);
    expect(isXgTab('integrations')).toBe(false);
    expect(isXgTab(undefined)).toBe(false);
  });
});
