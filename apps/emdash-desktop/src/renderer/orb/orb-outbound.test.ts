// [XG-CUSTOM 2026-10-12] 「球 → 主窗」单一入口的回归（意图 → 通道）
import { describe, expect, it } from 'vitest';
import { EMBEDDED_OPEN_METHOD, planOutbound } from './orb-outbound';

describe('planOutbound：出球的唯一判定处', () => {
  it('open_tab + 合法 URL ⇒ 开内嵌浏览器通道', () => {
    const p = planOutbound({ intent: 'open_tab', url: 'https://example.com/a' });
    expect(p.channel).toBe(EMBEDDED_OPEN_METHOD);
    expect(p.url).toBe('https://example.com/a');
  });

  it('open_tab 从 payload.url 取（原有通路就是这么传的）', () => {
    const p = planOutbound({ intent: 'open_tab', method: EMBEDDED_OPEN_METHOD, payload: { url: 'https://x.test/' } });
    expect(p.channel).toBe(EMBEDDED_OPEN_METHOD);
    expect(p.url).toBe('https://x.test/');
  });

  it('open_tab 没有 URL / 非 http ⇒ 如实报不支持（不假成功）', () => {
    expect(planOutbound({ intent: 'open_tab' }).channel).toBe('unsupported');
    expect(planOutbound({ intent: 'open_tab', url: 'file:///etc/passwd' }).channel).toBe('unsupported');
  });

  it('show_in_conversation ⇒ 会话消息通道，并标出对应的官方方法', () => {
    const p = planOutbound({ intent: 'show_in_conversation' });
    expect(p.channel).toBe('conversation.send');
    expect(p.futureMethod).toBe('ui/message');
  });

  it('model_only ⇒ 现在如实报「没有这条通道」，并给将来对应的官方方法', () => {
    const p = planOutbound({ intent: 'model_only' });
    expect(p.channel).toBe('unsupported');
    expect(p.futureMethod).toBe('ui/update-model-context');
    expect(p.reason).toContain('不许假成功');
  });

  it('别的动作方法 ⇒ 一律 pass-through（零干预既有白名单动作）', () => {
    const p = planOutbound({ intent: 'open_tab', method: 'host.someOtherAction', payload: { url: 'https://a.b/' } });
    expect(p.channel).toBe('pass-through');
  });

  it('未知意图 ⇒ 不支持', () => {
    // @ts-expect-error 故意传一个非法意图，确认不会静默当成功
    expect(planOutbound({ intent: 'nonsense' }).channel).toBe('unsupported');
  });
});
