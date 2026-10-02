import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROFILE_PARTITION,
  BROWSER_ISOLATED_PROFILE_ID,
  browserProfileBotId,
  browserProfileIdFromPartition,
  browserProfilePartition,
  createBrowserSessionSnapshot,
  DEFAULT_BROWSER_PROFILE_ID,
  isBrowsingDataKind,
  makeBotBrowserProfileId,
  makeIsolatedBrowserPartition,
  makeBrowserSessionIdentity,
  normalizeBrowserBotId,
  normalizeBrowserProfileSelection,
  normalizeBrowserUrl,
  resolveBotBrowserProfileId,
} from './browser';

describe('normalizeBrowserUrl', () => {
  it('defaults localhost-like inputs to http', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toEqual({
      ok: true,
      url: 'http://localhost:5173/',
      protocol: 'http:',
    });
    expect(normalizeBrowserUrl('127.0.0.1:3000/app')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:3000/app',
      protocol: 'http:',
    });
  });

  it('defaults public domains to https', () => {
    expect(normalizeBrowserUrl('example.com/path')).toEqual({
      ok: true,
      url: 'https://example.com/path',
      protocol: 'https:',
    });
  });

  it('uses Google search for non-URL input', () => {
    expect(normalizeBrowserUrl('react compiler')).toEqual({
      ok: true,
      url: 'https://www.google.com/search?q=react+compiler',
      protocol: 'https:',
    });
    expect(normalizeBrowserUrl('vitest')).toEqual({
      ok: true,
      url: 'https://www.google.com/search?q=vitest',
      protocol: 'https:',
    });
    expect(normalizeBrowserUrl('react: useState')).toEqual({
      ok: true,
      url: 'https://www.google.com/search?q=react%3A+useState',
      protocol: 'https:',
    });
  });

  it('can reject search-like inputs when validating actual navigation URLs', () => {
    expect(normalizeBrowserUrl('react: useState', { allowSearchQueries: false })).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
    expect(normalizeBrowserUrl('mailto: user@example.com', { allowSearchQueries: false })).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });

  it('allows about blank and blocks unsupported protocols', () => {
    expect(normalizeBrowserUrl('about:blank')).toEqual({
      ok: true,
      url: 'about:blank',
      protocol: 'about:',
    });
    expect(normalizeBrowserUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
    expect(normalizeBrowserUrl('data:text/html,hello')).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });

  it('blocks file URLs unless explicitly allowed', () => {
    expect(normalizeBrowserUrl('file:///tmp/index.html')).toEqual({
      ok: false,
      reason: 'unsupported-file-url',
    });
    expect(normalizeBrowserUrl('file:///tmp/index.html', { allowFileUrls: true })).toEqual({
      ok: true,
      url: 'file:///tmp/index.html',
      protocol: 'file:',
    });
  });
});

describe('isBrowsingDataKind', () => {
  it('accepts every supported browsing data category', () => {
    for (const kind of ['all', 'cookies', 'siteData', 'cache']) {
      expect(isBrowsingDataKind(kind)).toBe(true);
    }
  });

  it('rejects unknown kinds', () => {
    expect(isBrowsingDataKind('storage')).toBe(false);
    expect(isBrowsingDataKind('history')).toBe(false);
    expect(isBrowsingDataKind('downloads')).toBe(false);
    expect(isBrowsingDataKind('')).toBe(false);
  });
});

describe('browser profile selection', () => {
  it('falls back to the first available profile when default was deleted', () => {
    expect(
      normalizeBrowserProfileSelection('missing', [
        { id: 'personal', name: 'Personal' },
        { id: 'work', name: 'Work' },
      ])
    ).toBe('personal');
  });
});

describe('browser session identity', () => {
  it('assigns the default persistent profile partition to new sessions', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'Browser One',
      projectId: 'Project/One',
      workspaceId: 'Workspace.One',
      taskId: 'Task One',
    });

    expect(BROWSER_PROFILE_PARTITION).toBe('persist:emdash-browser-profile');
    expect(createBrowserSessionSnapshot({ identity, now: 100 }).partition).toBe(
      BROWSER_PROFILE_PARTITION
    );
  });

  it('can assign an isolated persistent task partition', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'Browser One',
      projectId: 'Project/One',
      workspaceId: 'Workspace.One',
      taskId: 'Task One',
    });

    expect(makeIsolatedBrowserPartition(identity)).toBe(
      'persist:emdash-browser-isolated-Project_One-Workspace_One-Task_One'
    );
    expect(
      createBrowserSessionSnapshot({
        identity,
        profileId: BROWSER_ISOLATED_PROFILE_ID,
        now: 100,
      })
    ).toMatchObject({
      profileId: BROWSER_ISOLATED_PROFILE_ID,
      partition: 'persist:emdash-browser-isolated-Project_One-Workspace_One-Task_One',
    });
  });

  it('creates safe snapshots with normalized URLs', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    expect(
      createBrowserSessionSnapshot({
        identity,
        currentUrl: 'javascript:alert(1)',
        now: 100,
      })
    ).toMatchObject({
      browserId: 'browser-1',
      currentUrl: 'about:blank',
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it('preserves bare host URLs in snapshots', () => {
    const identity = makeBrowserSessionIdentity({
      browserId: 'browser-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
    });

    expect(
      createBrowserSessionSnapshot({
        identity,
        currentUrl: 'intranet',
        now: 100,
      })
    ).toMatchObject({
      currentUrl: 'https://intranet/',
    });
  });
});


// [XG-CUSTOM] bot ⟷ profile：唯一真源 = botId。这些用例锁住三件事：
//  ① 未绑定 bot / 没带 bot → 与今天一致（Default / defaultProfileId）；
//  ② 绑定了的 bot → 精确落到它自己那个 profile；
//  ③ partition ↔ profileId 双向可逆（9223 桥的 /json/list 靠它反推 bot 身份）。
describe('[XG-CUSTOM] bot ⟷ 浏览器 profile', () => {
  const profiles = [
    { id: DEFAULT_BROWSER_PROFILE_ID, name: 'Default' },
    { id: 'bot-sxsj', name: 'sxsj', botId: 'sxsj' },
    { id: 'bot-babado', name: 'babado', botId: 'babado' },
  ];

  it('未带 botId → 用 defaultProfileId（零回归）', () => {
    expect(resolveBotBrowserProfileId(undefined, profiles, DEFAULT_BROWSER_PROFILE_ID)).toBe(
      DEFAULT_BROWSER_PROFILE_ID
    );
    expect(resolveBotBrowserProfileId('', profiles, 'bot-sxsj')).toBe('bot-sxsj');
  });

  it('未绑定的 bot → 仍落 defaultProfileId（不猜、不自动建）', () => {
    expect(resolveBotBrowserProfileId('scout', profiles, DEFAULT_BROWSER_PROFILE_ID)).toBe(
      DEFAULT_BROWSER_PROFILE_ID
    );
  });

  it('绑定了的 bot → 精确落到它自己那个 profile（两个 bot 不会撞同一个 partition）', () => {
    const a = resolveBotBrowserProfileId('sxsj', profiles, DEFAULT_BROWSER_PROFILE_ID);
    const b = resolveBotBrowserProfileId('babado', profiles, DEFAULT_BROWSER_PROFILE_ID);
    expect(a).toBe('bot-sxsj');
    expect(b).toBe('bot-babado');
    expect(browserProfilePartition(a)).not.toBe(browserProfilePartition(b));
  });

  it('browserProfileBotId 认得出归属，未绑定返回 undefined', () => {
    expect(browserProfileBotId('bot-sxsj', profiles)).toBe('sxsj');
    expect(browserProfileBotId(DEFAULT_BROWSER_PROFILE_ID, profiles)).toBeUndefined();
  });

  it('partition → profileId 可逆（Default 与具名 profile 都对得上）', () => {
    expect(browserProfileIdFromPartition(BROWSER_PROFILE_PARTITION)).toBe(
      DEFAULT_BROWSER_PROFILE_ID
    );
    expect(browserProfileIdFromPartition(browserProfilePartition('bot-sxsj'))).toBe('bot-sxsj');
    // per-task 隔离分区 / 别的 session 不算具名 profile
    expect(
      browserProfileIdFromPartition(
        makeIsolatedBrowserPartition(
          makeBrowserSessionIdentity({
            browserId: 'b1',
            projectId: 'p',
            workspaceId: 'w',
            taskId: 't',
          })
        )
      )
    ).toBeUndefined();
    expect(browserProfileIdFromPartition('persist:emdash-app')).toBeUndefined();
  });

  it('makeBotBrowserProfileId 生成 bot-<id> 且重名会加后缀', () => {
    expect(makeBotBrowserProfileId('Scout', profiles)).toBe('bot-scout');
    expect(makeBotBrowserProfileId('sxsj', profiles)).toBe('bot-sxsj-2');
    expect(normalizeBrowserBotId('  Chief Engineer  ')).toBe('chief-engineer');
  });
});
