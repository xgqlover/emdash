// [XG-CUSTOM] 项我球右键菜单「补齐项」的主进程单测：模型目录 / 换头像 / 划词开关 / 编辑动作。
//
// 假 electron（照同目录 ./xiangwo-orb.test.ts 的做法）：
//   - `Menu.buildFromTemplate` 收下模板（测试直接断言模板里有哪些项），`popup` 时按
//     `state.clickLabel` 模拟"用户点了哪一项"，再触发 callback —— 真机的顺序就是这样。
//   - `dialog.showOpenDialog` 返回 `state.dialogResult`（模拟用户在文件框里选了什么）。
//   - `app.getPath('userData')` 指向每个用例独立的临时目录（验落盘/读回/恢复默认）。
//
// 覆盖（对应任务书自检）：
//   ① `floating.modelCatalog` 的结构 + **诚实**（实测 8900 不支持选模型 → supported:false、唯一项 disabled）
//   ② `floating.setOverlayModel` 落盘与读回；目录外的模型被拒
//   ③ 头像 magic-byte 校验：合法 GIF/PNG/WEBP、扩展名与 magic 不符、超 2MB、非法类型
//      + 读侧也校验 magic（旧实现只信扩展名）+ 恢复默认头像
//   ④ 菜单项存在性：模型子菜单 / 换头像… / 恢复默认头像 / 划词开关 / isEditable 时的 cut-copy-paste
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 菜单项（只声明本用例关心的字段） */
type MenuItem = {
  label?: string;
  type?: string;
  role?: string;
  enabled?: boolean;
  submenu?: MenuItem[];
  click?: () => void;
};

const state = vi.hoisted(() => ({
  userData: { dir: '' },
  handlers: new Map<string, (...args: never[]) => unknown>(),
  templates: [] as MenuItem[][],
  /** 下一轮 popup 时"点"哪个 label；null = 点菜单外面（关闭） */
  clickLabel: null as string | null,
  openDialogCalls: 0,
  lastDialogOptions: undefined as unknown,
  dialogResult: { canceled: true, filePaths: [] as string[] },
}));

vi.mock('electron', () => {
  /** 在（可能嵌套的）菜单模板里按 label 找一项 */
  const findItem = (items: MenuItem[], label: string | null): MenuItem | undefined => {
    if (label === null) return undefined;
    for (const item of items) {
      if (item.label === label) return item;
      const nested = findItem(item.submenu ?? [], label);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return {
    app: {
      getPath: () => state.userData.dir,
      getAppPath: () => state.userData.dir,
      quit: vi.fn(),
      relaunch: vi.fn(),
      exit: vi.fn(),
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: never[]) => unknown) => {
        state.handlers.set(channel, fn);
      },
    },
    dialog: {
      showOpenDialog: vi.fn((...args: unknown[]) => {
        state.openDialogCalls += 1;
        state.lastDialogOptions = args[args.length - 1];
        return Promise.resolve(state.dialogResult);
      }),
    },
    Menu: {
      buildFromTemplate: (template: MenuItem[]) => {
        state.templates.push(template);
        return {
          popup: (options?: { callback?: () => void }) => {
            findItem(template, state.clickLabel)?.click?.();
            options?.callback?.();
          },
        };
      },
    },
    shell: { openExternal: vi.fn() },
  };
});

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { routeOrbApi, registerXiangwoOrbApi } = await import('./xiangwo-orb-api');

/** 球壳能力（菜单只用到 getWindow，其余给最小实现） */
const deps = {
  applyMode: () => ({ horizontal: 'right' as const, vertical: 'down' as const }),
  moveBall: () => ({ docked: null }),
  clampBall: () => ({ docked: null }),
  unsnapBall: () => ({ docked: null }),
  getWindow: () => ({ isDestroyed: () => false }),
};
// 真机在 bootstrap 里注册一次；这里注册一次给整份用例用
registerXiangwoOrbApi(deps as never);

/** 当渲染进程那样调一次球 API（主进程侧只有 `xiangwo:orb-api` 一个入口） */
function call<T>(method: string, args: unknown = {}): Promise<T> {
  const handler = state.handlers.get('xiangwo:orb-api');
  if (handler === undefined) throw new Error('no ipc handler for xiangwo:orb-api');
  return Promise.resolve((handler as (...a: unknown[]) => T)({}, method, args));
}

/** 在（可能嵌套的）已弹出模板里按 label 找一项 */
function findIn(items: MenuItem[], label: string): MenuItem | undefined {
  for (const item of items) {
    if (item.label === label) return item;
    const nested = findIn(item.submenu ?? [], label);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** 弹一次右键菜单并"点"某一项（null = 点菜单外面关掉） */
async function clickMenu(label: string | null, args: unknown = {}) {
  state.clickLabel = label;
  state.templates.length = 0;
  return await call<Record<string, unknown>>('floating.contextMenu', args);
}

/** 只弹菜单、点外面关掉，然后把模板拿回来给断言用 */
async function menuTemplate(args: unknown): Promise<MenuItem[]> {
  await clickMenu(null, args);
  return state.templates[state.templates.length - 1];
}

const userFile = (name: string): string => join(state.userData.dir, name);
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(userFile(name), 'utf8')) as Record<string, unknown>;

/** 真图片头（magic bytes 判的就是这些前缀，后面随便补几个字节当"内容"） */
const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x02]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x01,
]);
/** 合法 magic、但不在白名单里（JPEG） */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** 写一个假的"用户在文件框里选中的图片"（放在 userData/picked/ 下，不污染落盘区） */
function writePicked(name: string, bytes: Buffer): string {
  const dir = join(state.userData.dir, 'picked');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

beforeEach(() => {
  state.userData.dir = mkdtempSync(join(tmpdir(), 'xiangwo-orb-menu-'));
  state.templates.length = 0;
  state.clickLabel = null;
  state.openDialogCalls = 0;
  state.lastDialogOptions = undefined;
  state.dialogResult = { canceled: true, filePaths: [] };
  // 关掉菜单模板的 trace 日志噪音（仍走同一段代码）
  vi.stubEnv('XIANGWO_ORB_TRACE', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(state.userData.dir, { recursive: true, force: true });
});

describe('floating.modelCatalog（实测结论要诚实）', () => {
  it('8900 不支持选模型 → supported:false，唯一项 disabled 且标「（当前唯一）」', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-8900');
    const catalog = await call<{
      supported: boolean;
      current: { provider: string; model: string };
      groups: Array<{ id: string; name: string; models: Array<Record<string, unknown>> }>;
      reason: string;
    }>('floating.modelCatalog');

    expect(catalog.supported).toBe(false);
    expect(catalog.current).toEqual({ provider: 'xiangwo', model: 'xiangwo-8900' });
    expect(catalog.groups).toHaveLength(1);
    expect(catalog.groups[0].id).toBe('xiangwo');
    expect(catalog.groups[0].models).toEqual([
      {
        id: 'xiangwo-8900',
        name: 'xiangwo-8900',
        current: true,
        enabled: false,
        note: '（当前唯一）',
      },
    ]);
    // 说明必须是人话且非空 —— 菜单要拿它当 disabled 行显示
    expect(catalog.reason.length).toBeGreaterThan(0);
  });

  it('XIANGWO_MODEL 覆盖生效（显示的就是真实在用的那个标识）', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-alt');
    const catalog = await call<{ current: { model: string } }>('floating.modelCatalog');
    expect(catalog.current.model).toBe('xiangwo-alt');
  });

  it('floating.overlayModel 与目录里的 current 一致', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-xyz');
    const model = await call<{ provider: string; model: string }>('floating.overlayModel');
    const catalog = await call<{ current: { provider: string; model: string } }>(
      'floating.modelCatalog'
    );
    expect(model).toEqual(catalog.current);
  });

  it('目录数据可直接经 routeOrbApi 拿到（不依赖 IPC 注册）', async () => {
    const catalog = await routeOrbApi(deps as never, 'floating.modelCatalog', {});
    expect((catalog as { supported: boolean }).supported).toBe(false);
  });
});

describe('floating.setOverlayModel（落盘与读回）', () => {
  it('目录里的模型：写盘 + 读回一致', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-8900');
    const applied = await call<{ provider: string; model: string }>('floating.setOverlayModel', {
      provider: 'xiangwo',
      model: 'xiangwo-8900',
    });
    expect(applied).toEqual({ provider: 'xiangwo', model: 'xiangwo-8900' });
    expect(readJson('xiangwo-orb-models.json')).toEqual({
      provider: 'xiangwo',
      model: 'xiangwo-8900',
    });
    // 再读一次目录：stored 就是刚写进去的值（证明读回走的是盘，不是内存）
    const catalog = await call<{ stored?: unknown }>('floating.modelCatalog');
    expect(catalog.stored).toEqual({ provider: 'xiangwo', model: 'xiangwo-8900' });
  });

  it('reasoningEffort 一并落盘（等 8900 支持时数据形状已经对）', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-8900');
    await call('floating.setOverlayModel', {
      provider: 'xiangwo',
      model: 'xiangwo-8900',
      reasoningEffort: 'high',
    });
    expect(readJson('xiangwo-orb-models.json')).toEqual({
      provider: 'xiangwo',
      model: 'xiangwo-8900',
      reasoningEffort: 'high',
    });
  });

  it('目录里没有的模型 → 拒绝（返回当前真实值，且不写盘）', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-8900');
    const applied = await call<{ model: string }>('floating.setOverlayModel', {
      provider: 'xiangwo',
      model: 'totally-bogus-xyz',
    });
    expect(applied.model).toBe('xiangwo-8900');
    expect(() => readJson('xiangwo-orb-models.json')).toThrow();
  });

  it('provider 不对也拒（不会把别的 provider 的模型写进来）', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-8900');
    await call('floating.setOverlayModel', { provider: 'someone-else', model: 'xiangwo-8900' });
    expect(() => readJson('xiangwo-orb-models.json')).toThrow();
  });
});

describe('换头像：magic-byte 校验（照上游 orb-avatar.ts:85-172）', () => {
  it('合法 GIF → 落盘 + avatarUrl 给出 image/gif', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('a.gif', GIF_BYTES)] };
    const result = await clickMenu('换头像…');
    expect(result).toEqual({ action: 'pick-avatar', avatarChanged: true });
    expect(readJson('xiangwo-orb-avatar.json')).toEqual({ mime: 'image/gif' });
    const url = await call<string>('floating.avatarUrl');
    expect(url.startsWith('data:image/gif;base64,')).toBe(true);
  });

  it('合法 PNG → 落盘 + avatarUrl 给出 image/png', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('a.png', PNG_BYTES)] };
    expect(await clickMenu('换头像…')).toEqual({ action: 'pick-avatar', avatarChanged: true });
    const url = await call<string>('floating.avatarUrl');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('合法 WEBP → 落盘 + avatarUrl 给出 image/webp', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('a.webp', WEBP_BYTES)] };
    expect(await clickMenu('换头像…')).toEqual({ action: 'pick-avatar', avatarChanged: true });
    const url = await call<string>('floating.avatarUrl');
    expect(url.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('扩展名与 magic 不符（PNG 字节叫 .gif）→ 拒收 + 人话文案 + 不落盘', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('fake.gif', PNG_BYTES)] };
    const result = await clickMenu('换头像…');
    expect(result.avatarChanged).toBeUndefined();
    expect(result.message).toContain('不是支持的图片格式');
    expect(() => readJson('xiangwo-orb-avatar.json')).toThrow();
    expect(await call<string>('floating.avatarUrl')).toBe('');
  });

  it('超过 2MB → 「太大」文案 + 不落盘', async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024, 0x41)]);
    state.dialogResult = { canceled: false, filePaths: [writePicked('big.png', big)] };
    const result = await clickMenu('换头像…');
    expect(result.message).toContain('太大');
    expect(result.message).toContain('2MB');
    expect(await call<string>('floating.avatarUrl')).toBe('');
  });

  it('非法类型（JPEG 字节叫 .png / 纯文本叫 .png）→ 拒收', async () => {
    for (const bytes of [JPEG_BYTES, Buffer.from('这不是图片')]) {
      state.dialogResult = { canceled: false, filePaths: [writePicked('text.png', bytes)] };
      const result = await clickMenu('换头像…');
      expect(result.message).toContain('不是支持的图片格式');
      expect(await call<string>('floating.avatarUrl')).toBe('');
    }
  });

  it('文件框只过滤 gif/png/webp', async () => {
    await clickMenu('换头像…');
    expect(state.openDialogCalls).toBe(1);
    const options = state.lastDialogOptions as { filters?: Array<{ extensions: string[] }> };
    expect(options.filters?.[0].extensions).toEqual(['gif', 'png', 'webp']);
  });

  it('取消选择 → 什么都不变、无文案', async () => {
    expect(await clickMenu('换头像…')).toEqual({ action: 'pick-avatar' });
    expect(await call<string>('floating.avatarUrl')).toBe('');
  });

  it('读侧也校验 magic：改名成 .png 的 GIF 按**字节**当 GIF 发（不再只信扩展名）', async () => {
    // 手工放一个"扩展名是 png、内容其实是 gif"的文件（旧实现的漏洞场景）
    writeFileSync(userFile('xiangwo-orb-avatar.png'), GIF_BYTES);
    const url = await call<string>('floating.avatarUrl');
    expect(url.startsWith('data:image/gif;base64,')).toBe(true);
  });

  it('读侧也校验 magic：认不出来的字节文件被跳过（不会喂给 <img>）', async () => {
    writeFileSync(userFile('xiangwo-orb-avatar.png'), Buffer.from('这不是图片'));
    expect(await call<string>('floating.avatarUrl')).toBe('');
    expect(findIn(await menuTemplate({}), '恢复默认头像')?.enabled).toBe(false);
  });

  it('旧版 dataUrl 落盘（xiangwo-orb-avatar.json）仍能读出来', async () => {
    writeFileSync(
      userFile('xiangwo-orb-avatar.json'),
      JSON.stringify({ dataUrl: `data:image/png;base64,${PNG_BYTES.toString('base64')}` })
    );
    expect(await call<string>('floating.avatarUrl')).toBe(
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    );
  });

  it('旧版 dataUrl 里是 JPEG → 不再是"任意 data:image/*"，直接忽略', async () => {
    writeFileSync(
      userFile('xiangwo-orb-avatar.json'),
      JSON.stringify({ dataUrl: 'data:image/jpeg;base64,AAAA' })
    );
    expect(await call<string>('floating.avatarUrl')).toBe('');
  });

  it('恢复默认头像 → 删掉落盘文件 + avatarChanged:true', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('a.gif', GIF_BYTES)] };
    await clickMenu('换头像…');
    expect(await call<string>('floating.avatarUrl')).not.toBe('');

    const restored = await clickMenu('恢复默认头像');
    expect(restored).toEqual({ action: 'restore-avatar', avatarChanged: true });
    expect(await call<string>('floating.avatarUrl')).toBe('');
  });

  it('没头像时「恢复默认头像」不可点、点了也无变化', async () => {
    expect(findIn(await menuTemplate({}), '恢复默认头像')?.enabled).toBe(false);
    expect(await clickMenu('恢复默认头像')).toEqual({
      action: 'restore-avatar',
      avatarChanged: false,
    });
  });

  it('有头像时「恢复默认头像」可点', async () => {
    writeFileSync(userFile('xiangwo-orb-avatar.gif'), GIF_BYTES);
    expect(findIn(await menuTemplate({}), '恢复默认头像')?.enabled).toBe(true);
  });

  it('换第二张不同格式的头像 → 旧文件被清掉，不会有"两个文件谁赢"的歧义', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('a.gif', GIF_BYTES)] };
    await clickMenu('换头像…');
    state.dialogResult = { canceled: false, filePaths: [writePicked('b.png', PNG_BYTES)] };
    await clickMenu('换头像…');
    expect(await call<string>('floating.avatarUrl')).toBe(
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    );
    // .gif 那份必须已经删掉（否则读盘顺序会让它"复活"）
    expect(() => readFileSync(userFile('xiangwo-orb-avatar.gif'))).toThrow();
  });
});

describe('右键菜单项', () => {
  it('基础项：打开主窗 / 面板 / 模型 / 换头像… / 恢复默认头像 / 划词开关 / 退出', async () => {
    const labels = (await menuTemplate({})).map((item) => item.label);
    expect(labels).toEqual([
      '打开主窗口',
      '打开/收起面板',
      undefined, // separator
      '模型',
      '换头像…',
      '恢复默认头像',
      undefined, // separator
      '停用划词工具条', // 默认开 → 提供"停用"
      undefined, // separator
      '退出项我球',
    ]);
  });

  it('模型子菜单：分组标题 disabled + `✓ ` 前缀 + 「（当前唯一）」+ 说明行 disabled', async () => {
    vi.stubEnv('XIANGWO_MODEL', 'xiangwo-8900');
    const submenu = findIn(await menuTemplate({}), '模型')?.submenu ?? [];
    expect(submenu[0]).toMatchObject({ label: '项我 8900（实测不支持选模型）', enabled: false });
    // 绝不假装能切：唯一那一项是 disabled 的
    expect(submenu[1]).toMatchObject({ label: '✓ xiangwo-8900（当前唯一）', enabled: false });
    const note = submenu[submenu.length - 1];
    expect(note.enabled).toBe(false);
    expect(String(note.label)).toContain('仅回显');
  });

  it('不可编辑时**没有** cut/copy/paste（第一项就是"打开主窗口"）', async () => {
    const template = await menuTemplate({ editable: false });
    expect(template[0].label).toBe('打开主窗口');
    expect(template.some((item) => item.role !== undefined)).toBe(false);
  });

  it('可编辑时菜单顶部插 role:cut/copy/paste（enabled 跟随 editFlags）', async () => {
    const template = await menuTemplate({
      editable: true,
      editFlags: { canCut: true, canCopy: true, canPaste: false },
    });
    expect(template[0]).toMatchObject({ role: 'cut', enabled: true });
    expect(template[1]).toMatchObject({ role: 'copy', enabled: true });
    expect(template[2]).toMatchObject({ role: 'paste', enabled: false });
    expect(template[3].type).toBe('separator');
    expect(template[4].label).toBe('打开主窗口');
  });

  it('可编辑但没选中文字 → canCut/canCopy 关（跟着渲染进程报的 flags）', async () => {
    const template = await menuTemplate({
      editable: true,
      editFlags: { canCut: false, canCopy: false, canPaste: true },
    });
    expect(template[0]).toMatchObject({ role: 'cut', enabled: false });
    expect(template[1]).toMatchObject({ role: 'copy', enabled: false });
    expect(template[2]).toMatchObject({ role: 'paste', enabled: true });
  });

  it('划词开关：默认「启用」，点一下 → 翻成停用 + 落盘 + 回传新值', async () => {
    expect(await call<boolean>('floating.selectionToolbar')).toBe(true);
    expect(findIn(await menuTemplate({}), '停用划词工具条')).toBeDefined();

    const toggled = await clickMenu('停用划词工具条');
    expect(toggled).toEqual({ action: 'toggle-selection', selectionEnabled: false });
    expect(readJson('xiangwo-orb-selection.json')).toEqual({ enabled: false });
    expect(await call<boolean>('floating.selectionToolbar')).toBe(false);

    // 再弹一次：文案翻成"启用"，点一下又开回来
    expect(findIn(await menuTemplate({}), '启用划词工具条')).toBeDefined();
    const back = await clickMenu('启用划词工具条');
    expect(back).toEqual({ action: 'toggle-selection', selectionEnabled: true });
    expect(await call<boolean>('floating.selectionToolbar')).toBe(true);
  });

  it('划词开关只有一个**写**入口（右键菜单），渲染侧只能读', async () => {
    expect(await call<boolean>('floating.selectionToolbar')).toBe(true);
    await clickMenu('停用划词工具条');
    expect(await call<boolean>('floating.selectionToolbar')).toBe(false);
  });

  it('点「打开主窗口」/「退出项我球」只回动作，不弹文件框', async () => {
    expect(await clickMenu('打开主窗口')).toEqual({ action: 'open-main' });
    expect(await clickMenu('退出项我球')).toEqual({ action: 'quit' });
    expect(state.openDialogCalls).toBe(0);
  });

  it('点菜单外面（关闭）→ action:none', async () => {
    expect(await clickMenu(null)).toEqual({ action: 'none' });
  });

  it('换头像的 dialog 在**菜单关掉之后**才弹（不能在 click 回调里弹）', async () => {
    state.dialogResult = { canceled: false, filePaths: [writePicked('a.png', PNG_BYTES)] };
    state.clickLabel = '换头像…';
    state.templates.length = 0;
    // 走 routeOrbApi 而不是 call()，确保整条路径（含 await 顺序）都被覆盖
    const result = await routeOrbApi(deps as never, 'floating.contextMenu', {});
    expect(state.openDialogCalls).toBe(1);
    expect(result).toEqual({ action: 'pick-avatar', avatarChanged: true });
  });
});
