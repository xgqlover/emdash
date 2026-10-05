// [XG-CUSTOM 2026-10-05] trigger 配置的**语义校验**回归（config.ts 的 validateTriggerConfig / isWebhookTrigger）。
//
// 为什么单独钉它：表单能否保存、以及"webhook 缺 token 就等于开了个裸接口"这条安全约束，
// 全靠这两个纯函数；它们在 UI 里没有单测覆盖（表单 hook 是 React 的，不值得为这句话去搭一套）。
import { describe, expect, it } from 'vitest';
import { isWebhookTrigger, triggerConfigSchema, validateTriggerConfig } from './config';

describe('triggerConfigSchema 兼容性', () => {
  it('旧数据（没有 kind，只有 expr/tz）照旧可解析 → kind 缺省仍是 undefined（判定走 isWebhookTrigger）', () => {
    const parsed = triggerConfigSchema.parse({ expr: '0 9 * * *', tz: 'UTC' });
    expect(parsed.expr).toBe('0 9 * * *');
    expect(isWebhookTrigger(parsed)).toBe(false); // 缺 kind 一律当 cron
  });

  it('cron 触发（显式 kind）', () => {
    const parsed = triggerConfigSchema.parse({ kind: 'cron', expr: '0 9 * * *' });
    expect(isWebhookTrigger(parsed)).toBe(false);
    expect(validateTriggerConfig(parsed)).toBeNull();
  });

  it('webhook 触发（token + filter）', () => {
    const parsed = triggerConfigSchema.parse({
      kind: 'webhook',
      token: 'abcdefgh-1234-5678',
      filter: 'action == "opened"',
    });
    expect(isWebhookTrigger(parsed)).toBe(true);
    expect(validateTriggerConfig(parsed)).toBeNull();
  });
});

describe('validateTriggerConfig（表单/服务端共用的语义校验）', () => {
  it('cron 缺表达式 → 报错', () => {
    expect(validateTriggerConfig({ kind: 'cron', expr: '' })).toContain('cron');
    expect(validateTriggerConfig({ kind: 'cron', expr: '   ' })).toContain('cron');
    expect(validateTriggerConfig({ expr: '0 9 * * *' })).toBeNull(); // 缺 kind = cron
  });

  it('webhook 缺 token 或太短 → 报错（**不允许保存**：否则等于开个裸接口）', () => {
    expect(validateTriggerConfig({ kind: 'webhook' })).toContain('token');
    expect(validateTriggerConfig({ kind: 'webhook', token: 'short' })).toContain('token');
    expect(validateTriggerConfig({ kind: 'webhook', token: '   ' })).toContain('token');
  });

  it('webhook token 足够长 → 通过（filter 选填）', () => {
    expect(validateTriggerConfig({ kind: 'webhook', token: '12345678' })).toBeNull();
    expect(
      validateTriggerConfig({ kind: 'webhook', token: '12345678', filter: 'action == "opened"' })
    ).toBeNull();
  });
});
