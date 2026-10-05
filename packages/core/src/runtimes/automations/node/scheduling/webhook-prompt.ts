// [XG-CUSTOM 2026-10-05] **事件载荷 → prompt** 渲染（webhook 触发的 `promptTemplate`）。
//
// 为什么单独一个纯函数：这是"外部输入进 prompt"的边界，必须**可穷举、可测、无副作用**，
// 不能藏在调度器里顺手拼字符串。三条约定：
//   ① 没配 `promptTemplate` → **原样返回原 prompt**（零行为变化，老配置不受影响）；
//   ② 配了且含 `{{payload}}` → 占位符换成**格式化后的 payload**（JSON 缩进，便于模型读懂；
//      太长会被截到 `MAX_PAYLOAD_CHARS`，避免一次事件把上下文撑爆）；
//   ③ 配了但**没有占位符** → 把 payload **追加**在后面（否则模板等于把事件信息丢了）。
//
// 回归测试见 ./webhook-prompt.test.ts

import type { AutomationDeployment } from '../../api/deployment';

export const WEBHOOK_PAYLOAD_PLACEHOLDER = '{{payload}}';
export const WEBHOOK_PAYLOAD_MAX_CHARS = 4000;

/** payload 文本 → 尽量好看的字符串（JSON 就缩进；不是 JSON 就原样） */
export function formatWebhookPayload(payloadText: string): string {
  const text = (payloadText ?? '').trim();
  if (text === '') return '{}';
  try {
    const parsed: unknown = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（事件载荷过长，已截断到 ${String(max)} 字符）`;
}

/**
 * 渲染最终 prompt。
 * @param template 部署里的 `promptTemplate`（可缺省）
 * @param payloadText 事件原始 body
 * @param fallbackPrompt 没配模板时用的原 prompt（= 部署里 agent 自己的初始 prompt）
 */
export function renderWebhookPrompt(
  template: string | undefined,
  payloadText: string,
  fallbackPrompt: string,
  maxChars: number = WEBHOOK_PAYLOAD_MAX_CHARS
): string {
  const trimmed = (template ?? '').trim();
  if (trimmed === '') return fallbackPrompt;
  const payload = truncate(formatWebhookPayload(payloadText), maxChars);
  if (trimmed.includes(WEBHOOK_PAYLOAD_PLACEHOLDER)) {
    return trimmed.split(WEBHOOK_PAYLOAD_PLACEHOLDER).join(payload);
  }
  return `${trimmed}\n\n[事件载荷]\n${payload}`;
}

/**
 * 把渲染后的 prompt 装回部署（返回**新对象**，不改原 deployment）。
 * 两种 agent 形状分开处理（`automationAgentConfigSchema` 是判别联合）：
 *   · acp → `start.initialQueue[0].text`（队列第一条）
 *   · tui → `start.initialPrompt`
 * 没配模板 / 队列为空 → **原样返回**（零行为变化）。
 */
export function withWebhookPrompt<T extends AutomationDeployment>(deployment: T, payloadText: string): T {
  const template = deployment.webhook?.promptTemplate;
  if (template === undefined || template.trim() === '') return deployment;
  const agent = deployment.agent;
  if (agent.type === 'acp') {
    const first = agent.start.initialQueue[0];
    if (first === undefined) return deployment;
    const rendered = renderWebhookPrompt(template, payloadText, first.text);
    return {
      ...deployment,
      agent: {
        ...agent,
        start: { ...agent.start, initialQueue: [{ ...first, text: rendered }, ...agent.start.initialQueue.slice(1)] },
      },
    } as T;
  }
  const rendered = renderWebhookPrompt(template, payloadText, agent.start.initialPrompt);
  return { ...deployment, agent: { ...agent, start: { ...agent.start, initialPrompt: rendered } } } as T;
}
