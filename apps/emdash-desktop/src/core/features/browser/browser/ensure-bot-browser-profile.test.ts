// [XG-CUSTOM 2026-10-03] 「带 botId 开内嵌页 → 落到哪个 profile」的判据。
//
// 这是 botId 能不能出现在 `/json/list` 的关键一步：只有真的用上「绑定该 bot 的 profile」
// （没有就按需建 `bot-<botId>`），partition 才反推得出 bot 身份；落在 default /
// `isolated-per-task` 上就永远是空 botId（agent 分不清"这一页是不是我的"）。
import { describe, expect, it } from 'vitest';
import { resolveOpenProfile } from './ensure-bot-browser-profile';

const DEFAULT_PROFILE = { id: 'default', name: 'Default' };
const SXSJ_PROFILE = { id: 'bot-sxsj', name: 'sxsj', botId: 'sxsj' };

describe('[XG-CUSTOM] resolveOpenProfile（botId → profile）', () => {
  it('没带 botId → 完全走老逻辑（defaultProfileId / 显式 profile）', () => {
    expect(
      resolveOpenProfile({
        profiles: [DEFAULT_PROFILE],
        defaultProfileId: 'default',
      })
    ).toEqual({ profiles: [DEFAULT_PROFILE], profileId: 'default', botId: '' });
    expect(
      resolveOpenProfile({
        requestedProfileId: 'bot-sxsj',
        profiles: [DEFAULT_PROFILE, SXSJ_PROFILE],
        defaultProfileId: 'default',
      }).profileId
    ).toBe('bot-sxsj');
  });

  it('带 botId 且已绑定 → 用绑定它的那个 profile（不新建）', () => {
    const r = resolveOpenProfile({
      botId: 'sxsj',
      profiles: [DEFAULT_PROFILE, SXSJ_PROFILE],
      defaultProfileId: 'default',
    });
    expect(r.profileId).toBe('bot-sxsj');
    expect(r.createdProfile).toBeUndefined();
    expect(r.profiles).toHaveLength(2);
  });

  it('带 botId 但没绑定 → 按需建（用主进程下发的确定性 id），botId 真的带上页', () => {
    const r = resolveOpenProfile({
      requestedProfileId: 'bot-xg-mcp-probe',
      botId: 'xg-mcp-probe',
      profiles: [DEFAULT_PROFILE],
      defaultProfileId: 'isolated-per-task',
    });
    expect(r.profileId).toBe('bot-xg-mcp-probe');
    expect(r.createdProfile).toEqual({
      id: 'bot-xg-mcp-probe',
      name: 'xg-mcp-probe',
      botId: 'xg-mcp-probe',
    });
    expect(r.profiles).toHaveLength(2);
  });

  it('没收到确定性 id（老调用方 / 直接调用）→ 本地按 `bot-<botId>` 派生', () => {
    const r = resolveOpenProfile({
      botId: 'xg-mcp-probe',
      profiles: [DEFAULT_PROFILE],
      defaultProfileId: 'default',
    });
    expect(r.profileId).toBe('bot-xg-mcp-probe');
    expect(r.createdProfile?.botId).toBe('xg-mcp-probe');
  });

  it('botId 规范化（大写/下划线 → `-`）+ 重名不撞已有 profile', () => {
    const r = resolveOpenProfile({
      botId: 'XG_MCP_Probe',
      profiles: [DEFAULT_PROFILE, { id: 'bot-xg-mcp-probe', name: '别的东西' }],
      defaultProfileId: 'default',
    });
    expect(r.botId).toBe('xg-mcp-probe');
    expect(r.profileId).toBe('bot-xg-mcp-probe-2');
    expect(r.createdProfile?.id).toBe('bot-xg-mcp-probe-2');
  });

  it('拿不到设置（profiles undefined）→ 不瞎建，回退老逻辑', () => {
    const r = resolveOpenProfile({ botId: 'xg-mcp-probe', defaultProfileId: 'default' });
    expect(r.profileId).toBe('default');
    expect(r.createdProfile).toBeUndefined();
  });
});
