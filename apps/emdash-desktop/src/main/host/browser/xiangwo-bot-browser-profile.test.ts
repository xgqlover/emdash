// [XG-CUSTOM] bot ⟷ 浏览器 profile 主进程侧解析单测。
//
// 这一层是「设置页写的绑定」与「9223 桥/反向通道查表」之间的唯一接缝，所以只钉住三件事：
//  ① 没收到过设置 / 设置里没绑定 → Default（零回归）；
//  ② 绑定刷新后立刻生效（同一次 setBrowserCorsRelaxationSettings 调用）；
//  ③ `xiangwoBoundProfileIdForBot`（挑"要复用的那一页"用）**不猜 default**。
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setBrowserCorsRelaxationSettings } from './browser-profile-session';
import {
  xiangwoBotBrowserMapPath,
  xiangwoBotIdForBrowserProfile,
  xiangwoBoundProfileIdForBot,
  xiangwoBrowserProfilesSnapshot,
  xiangwoProfileIdForBot,
} from './xiangwo-bot-browser-profile';
import { DEFAULT_BROWSER_PROFILE_ID } from '@core/primitives/browser/api';

function browserSettings(profiles: Array<{ id: string; name: string; botId?: string }>) {
  return {
    defaultProfileId: DEFAULT_BROWSER_PROFILE_ID,
    relaxCorsForLocalhost: false,
    profiles,
  };
}

describe('[XG-CUSTOM] xiangwo-bot-browser-profile', () => {
  // 单测别去写真的 ~/.xiangwo：派生映射表的落点用临时目录覆盖
  const mapDir = mkdtempSync(join(tmpdir(), 'xg-bot-map-'));
  const mapFile = join(mapDir, 'bot-browser-map.json');
  const previousMapFile = process.env.XIANGWO_BOT_MAP_FILE;
  beforeAll(() => {
    process.env.XIANGWO_BOT_MAP_FILE = mapFile;
  });
  afterAll(() => {
    if (previousMapFile === undefined) delete process.env.XIANGWO_BOT_MAP_FILE;
    else process.env.XIANGWO_BOT_MAP_FILE = previousMapFile;
  });

  it('收到设置前：一切落到 Default（零回归）', () => {
    expect(xiangwoProfileIdForBot('sxsj')).toBe(DEFAULT_BROWSER_PROFILE_ID);
    expect(xiangwoProfileIdForBot('')).toBe(DEFAULT_BROWSER_PROFILE_ID);
    expect(xiangwoBotIdForBrowserProfile(DEFAULT_BROWSER_PROFILE_ID)).toBeUndefined();
  });

  it('绑定刷新后立刻生效：bot → 自己的 profile，反向也查得到 botId', () => {
    setBrowserCorsRelaxationSettings(
      browserSettings([
        { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
        { id: 'bot-sxsj', name: 'sxsj', botId: 'sxsj' },
        { id: 'bot-babado', name: 'babado', botId: 'babado' },
      ])
    );
    expect(xiangwoProfileIdForBot('sxsj')).toBe('bot-sxsj');
    expect(xiangwoProfileIdForBot('babado')).toBe('bot-babado');
    expect(xiangwoBotIdForBrowserProfile('bot-babado')).toBe('babado');
    // 未绑定的 bot 照旧 Default
    expect(xiangwoProfileIdForBot('scout')).toBe(DEFAULT_BROWSER_PROFILE_ID);
    expect(xiangwoBotIdForBrowserProfile(DEFAULT_BROWSER_PROFILE_ID)).toBeUndefined();
  });

  it('bound 变体只认显式绑定（挑复用页时不许猜 Default，否则会串别人的登录态）', () => {
    setBrowserCorsRelaxationSettings(
      browserSettings([
        { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
        { id: 'bot-sxsj', name: 'sxsj', botId: 'sxsj' },
      ])
    );
    expect(xiangwoBoundProfileIdForBot('sxsj')).toBe('bot-sxsj');
    expect(xiangwoBoundProfileIdForBot('scout')).toBeNull();
    expect(xiangwoBoundProfileIdForBot('')).toBeNull();
    expect(xiangwoBoundProfileIdForBot(undefined)).toBeNull();
  });

  it('映射表导出：botId → {emdash profile/partition, wego profile, 两级 learnings}', () => {
    setBrowserCorsRelaxationSettings(
      browserSettings([
        { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
        { id: 'bot-sxsj', name: 'sxsj', botId: 'sxsj' },
      ])
    );
    expect(xiangwoBotBrowserMapPath()).toBe(mapFile);
    const dump = JSON.parse(readFileSync(mapFile, 'utf8')) as {
      defaultProfileId: string;
      bots: Record<string, Record<string, unknown>>;
    };
    expect(dump.defaultProfileId).toBe(DEFAULT_BROWSER_PROFILE_ID);
    expect(Object.keys(dump.bots)).toEqual(['sxsj']);
    expect(dump.bots['sxsj']).toMatchObject({
      emdashProfile: 'bot-sxsj',
      emdashPartition: 'persist:emdash-browser-profile-bot-sxsj',
      wegoProfile: 'sxsj',
      learnings: {
        global: '~/.wego-lite/learnings',
        private: '~/.xiangwo/learnings/sxsj',
      },
    });
  });

  it('快照只读且跟着设置走（设置页删掉 profile 后查不到）', () => {
    setBrowserCorsRelaxationSettings(
      browserSettings([
        { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
        { id: 'bot-sxsj', name: 'sxsj', botId: 'sxsj' },
      ])
    );
    expect(xiangwoBrowserProfilesSnapshot().map((profile) => profile.id)).toEqual([
      DEFAULT_BROWSER_PROFILE_ID,
      'bot-sxsj',
    ]);
    setBrowserCorsRelaxationSettings(
      browserSettings([{ id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' }])
    );
    expect(xiangwoProfileIdForBot('sxsj')).toBe(DEFAULT_BROWSER_PROFILE_ID);
  });
});
