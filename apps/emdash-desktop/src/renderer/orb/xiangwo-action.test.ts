// [XG-CUSTOM 2026-10-05] 动作块解析/执行回归（jsdom 无关，纯函数）。
import { describe, expect, it } from 'vitest';
import {
  actionFailureText,
  parseXiangwoActionBlock,
  runXiangwoAction,
  stripXiangwoActionBlocks,
} from './xiangwo-action';

describe('parseXiangwoActionBlock', () => {
  it('解析单个动作', () => {
    const got = parseXiangwoActionBlock('好的\n```xiangwo-action\n{"id":"app.settings"}\n```\n');
    expect(got).toEqual([{ id: 'app.settings' }]);
  });

  it('带参数 / 数组多动作', () => {
    const got = parseXiangwoActionBlock(
      '```xiangwo-action\n[{"id":"view.task"},{"id":"app.newTask","args":{"title":"油瓶包装"}}]\n```'
    );
    expect(got).toEqual([{ id: 'view.task' }, { id: 'app.newTask', args: { title: '油瓶包装' } }]);
  });

  it('★坏 JSON / 缺 id → 跳过，不抛（宁可少做一个动作也不打断回复）', () => {
    expect(parseXiangwoActionBlock('```xiangwo-action\n{不是 json}\n```')).toEqual([]);
    expect(parseXiangwoActionBlock('```xiangwo-action\n{"args":{}}\n```')).toEqual([]);
    expect(parseXiangwoActionBlock('```xiangwo-action\n\n```')).toEqual([]);
  });

  it('无块 → 空数组；正文其它部分不受影响', () => {
    expect(parseXiangwoActionBlock('普通回复')).toEqual([]);
    expect(stripXiangwoActionBlocks('A\n```xiangwo-action\n{"id":"x.y"}\n```\nB')).toBe('A\n\nB');
  });
});

describe('runXiangwoAction', () => {
  it('成功：run 收到 host.runCommand + 原样 id', async () => {
    const calls: unknown[] = [];
    const got = await runXiangwoAction({ id: 'app.settings' }, async (method, payload) => {
      calls.push([method, payload]);
      return { ok: true };
    });
    expect(got).toEqual({ ok: true });
    expect(calls[0]).toEqual(['host.runCommand', { id: 'app.settings' }]);
  });

  it('★失败回执照原样带出来（不假装成功）', async () => {
    const got = await runXiangwoAction({ id: 'app.newTask' }, async () => ({
      ok: false,
      reason: 'needs-approval',
    }));
    expect(got).toEqual({ ok: false, reason: 'needs-approval' });
    expect(actionFailureText({ id: 'app.newTask' }, got)).toContain('需要你确认');
  });

  it('★run 抛异常 → 收敛成 failed，不抛', async () => {
    const got = await runXiangwoAction({ id: 'app.settings' }, async () => {
      throw new Error('通道断了');
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe('failed');
    expect(got.message).toContain('通道断了');
  });

  it('四种失败原因都有对应人话', () => {
    const a = { id: 'x.y' };
    for (const reason of ['needs-approval', 'unknown-command', 'unavailable', 'weird']) {
      expect(actionFailureText(a, { ok: false, reason }).length).toBeGreaterThan(4);
    }
    expect(actionFailureText(a, { ok: false, reason: 'unknown-command' })).toContain(
      '不在可执行清单'
    );
  });
});
