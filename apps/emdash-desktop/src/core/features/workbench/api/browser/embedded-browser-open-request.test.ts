// [XG-CUSTOM 2026-10-05] `pickTargetTask` 回归：**用户要看 → 开在用户眼前；agent 自用 → 维持隔离**。
import { describe, expect, it } from 'vitest';
import { pickTargetTask } from './embedded-browser-open-request';

const USER = { projectId: 'p-user', taskId: 't-user' };
const BOT = { projectId: 'bot-sxsj', taskId: 't-bot' };
const FIRST = { projectId: 'p-first', taskId: 't-first' };

describe('pickTargetTask', () => {
  it('★ presentToUser=true → 开在**用户当前 task**（哪怕 bot 有自己的 task）', () => {
    const got = pickTargetTask({ presentToUser: true, current: USER, botEntry: BOT, first: FIRST });
    expect(got).toEqual({ ref: USER, needsNavigation: false });
  });

  it('★ presentToUser=true 且当前没 task → 退到第一个，且**必须导航**', () => {
    const got = pickTargetTask({ presentToUser: true, botEntry: BOT, first: FIRST });
    expect(got).toEqual({ ref: FIRST, needsNavigation: true });
  });

  it('★ presentToUser=true 且一个 task 都没有 → undefined（调用方如实回失败）', () => {
    expect(pickTargetTask({ presentToUser: true })).toBeUndefined();
  });

  it('agent 自用（false）→ **维持原行为**：bot 自己的 task 优先，且不在那儿就导航', () => {
    const got = pickTargetTask({
      presentToUser: false,
      current: USER,
      botEntry: BOT,
      first: FIRST,
    });
    expect(got).toEqual({ ref: BOT, needsNavigation: true });
  });

  it('agent 自用但已经在 bot 的 task 里 → 不需要导航（零回归）', () => {
    const got = pickTargetTask({ presentToUser: false, current: BOT, botEntry: BOT });
    expect(got).toEqual({ ref: BOT, needsNavigation: false });
  });

  it('agent 自用、没有 botEntry → 当前 task（零回归）', () => {
    const got = pickTargetTask({ presentToUser: false, current: USER, first: FIRST });
    expect(got).toEqual({ ref: USER, needsNavigation: false });
  });
});
