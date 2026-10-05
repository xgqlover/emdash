// [XG-CUSTOM 2026-10-05] `promptTemplate` 渲染回归（webhook-prompt.ts）。
//
// 这是"外部输入进 prompt"的边界，必须钉死三种行为：没模板=原样、有占位符=替换、无占位符=追加；
// 外加"载荷过长要截断"与"非 JSON 不炸"。
import { describe, expect, it } from 'vitest';
import type { AutomationDeployment } from '../../api/deployment';
import {
  formatWebhookPayload,
  renderWebhookPrompt,
  WEBHOOK_PAYLOAD_MAX_CHARS,
  WEBHOOK_PAYLOAD_PLACEHOLDER,
  withWebhookPrompt,
} from './webhook-prompt';

const PAYLOAD = '{"action":"opened","pull_request":{"number":42}}';

describe('renderWebhookPrompt', () => {
  it('没配模板 → 原样返回原 prompt（零行为变化）', () => {
    expect(renderWebhookPrompt(undefined, PAYLOAD, '原 prompt')).toBe('原 prompt');
    expect(renderWebhookPrompt('', PAYLOAD, '原 prompt')).toBe('原 prompt');
    expect(renderWebhookPrompt('   ', PAYLOAD, '原 prompt')).toBe('原 prompt');
  });

  it('有占位符 → 替换成格式化后的 payload（JSON 缩进）', () => {
    const out = renderWebhookPrompt('处理这个事件：\n{{payload}}\n完成后总结', PAYLOAD, '原 prompt');
    expect(out).toContain('处理这个事件：');
    expect(out).toContain('"action": "opened"'); // 缩进过的 JSON
    expect(out).toContain('完成后总结');
    expect(out).not.toContain(WEBHOOK_PAYLOAD_PLACEHOLDER);
  });

  it('多个占位符都替换', () => {
    const out = renderWebhookPrompt('{{payload}} 再看一次 {{payload}}', PAYLOAD, 'x');
    expect(out.match(/"action": "opened"/g)).toHaveLength(2);
  });

  it('没有占位符 → 追加在后面（不丢事件信息）', () => {
    const out = renderWebhookPrompt('按仓库规范处理', PAYLOAD, '原 prompt');
    expect(out.startsWith('按仓库规范处理')).toBe(true);
    expect(out).toContain('[事件载荷]');
    expect(out).toContain('"action": "opened"');
  });

  it('载荷过长 → 截断并注明', () => {
    const huge = `{"blob":"${'x'.repeat(WEBHOOK_PAYLOAD_MAX_CHARS * 2)}"}`;
    const out = renderWebhookPrompt('{{payload}}', huge, 'x');
    expect(out).toContain('已截断到');
    expect(out.length).toBeLessThan(WEBHOOK_PAYLOAD_MAX_CHARS + 200);
  });

  it('非 JSON 载荷不炸（原样塞进去）', () => {
    expect(renderWebhookPrompt('{{payload}}', '不是 json 的纯文本', 'x')).toContain('不是 json 的纯文本');
    expect(formatWebhookPayload('')).toBe('{}');
  });
});

describe('withWebhookPrompt（装回部署，不改原对象）', () => {
  function deployment(overrides: Partial<AutomationDeployment> = {}): AutomationDeployment {
    return {
      automationId: 'auto-1',
      revision: 1,
      enabled: true,
      name: 'On event',
      schedule: null,
      webhook: { token: 'token-1234567890', promptTemplate: '事件来了：\n{{payload}}' },
      agent: {
        type: 'acp',
        start: {
          providerId: 'claude',
          model: null,
          initialQueue: [{ text: '原 prompt' }],
        },
      },
      workspace: {
        kind: 'worktree',
        repository: { host: { kind: 'local' }, path: { root: { kind: 'posix' }, segments: ['repo'] } },
        worktreePoolPath: { root: { kind: 'posix' }, segments: ['wt'] },
        baseRemote: 'origin',
        preservePatterns: [],
        git: { kind: 'create-branch', fromBranch: { type: 'local', branch: 'main' }, pushRemote: null },
      },
      ...overrides,
    } as AutomationDeployment;
  }

  it('acp：渲染进 initialQueue[0].text，且原部署没被改', () => {
    const original = deployment();
    const next = withWebhookPrompt(original, PAYLOAD);
    expect(original.agent.type === 'acp' && original.agent.start.initialQueue[0]!.text).toBe('原 prompt');
    expect(next.agent.type === 'acp' && next.agent.start.initialQueue[0]!.text).toContain('"action": "opened"');
  });

  it('没配模板 → 同一对象（零行为变化）', () => {
    const original = deployment({ webhook: { token: 'token-1234567890' } });
    expect(withWebhookPrompt(original, PAYLOAD)).toBe(original);
  });
});
