// [XG-CUSTOM 2026-10-05] 主界面「可被指挥命令」白名单的回归。
import { describe, expect, it } from 'vitest';
import {
  findHostCommand,
  HOST_COMMANDS,
  isHostCommand,
  listHostCommands,
  requiresApproval,
} from './xiangwo-host-commands';

describe('xiangwo-host-commands 白名单', () => {
  it('结构不变量：id 唯一 · 形如 x.y · 标题非空 · kind 合法', () => {
    const ids = HOST_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of HOST_COMMANDS) {
      expect(c.id).toMatch(/^[a-z][a-zA-Z]*\.[a-zA-Z]+$/);
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(['read', 'write']).toContain(c.kind);
    }
  });

  it('★ 默认从严：表外 id 一律不可执行（isHostCommand=false）', () => {
    expect(isHostCommand('app.definitelyNotACommand')).toBe(false);
    expect(isHostCommand('')).toBe(false);
    expect(findHostCommand('app.nope')).toBeUndefined();
  });

  it('★ 写类必须审批；读类可直接执行', () => {
    expect(requiresApproval('app.newTask')).toBe(true);
    expect(requiresApproval('app.newProject')).toBe(true);
    expect(requiresApproval('app.settings')).toBe(false);
    expect(requiresApproval('app.commandPalette')).toBe(false);
  });

  it('★ 表外 id 的审批判定也从严（true），不能因为查不到就放过', () => {
    expect(requiresApproval('not.inTable')).toBe(true);
    expect(requiresApproval('')).toBe(true);
  });

  it('listHostCommands 返回副本（外部改不动白名单）', () => {
    const a = listHostCommands() as { title: string }[];
    a[0]!.title = '被篡改';
    expect(listHostCommands()[0]!.title).not.toBe('被篡改');
    expect(HOST_COMMANDS[0]!.title).not.toBe('被篡改');
  });

  it('首次暴露的命令集合（与用户确认过的第一批一致）', () => {
    expect(new Set(HOST_COMMANDS.map((c) => c.id))).toEqual(
      new Set([
        'app.commandPalette',
        'app.settings',
        'app.navigateBack',
        'app.navigateForward',
        'view.task',
        'app.toggleTheme',
        'app.newTask',
        'app.newProject',
      ])
    );
  });
});
