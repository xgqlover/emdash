import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
//
// bot ⟷ 浏览器 profile 的主进程侧解析（唯一真源 = **botId**）。
//
// ── 为什么需要它 ──────────────────────────────────────────────────────────────
// 设置 → 浏览器 里的 profile 是**全局**的（一个 Default + 手动 Add profile），所有内嵌浏览器
// 标签页共用同一份 cookie/登录态。项我有 9 个业务 bot（sxsj/babado/dayi/…）+ 通用角色
// （scout/researcher/…），agent 侧只能用 `_exec_browser(name, args, key=<botId>)` 区分身份，
// emdash 侧的 profile 对它一无所知。这里就是那条桥：
//
//   botId ──(profiles[].botId)──▶ profileId ──▶ partition ──▶ 该 bot 的内嵌浏览器身份
//
// ── 边界 ─────────────────────────────────────────────────────────────────────
// · **只解析，不创建**：profile 由设置页（人）或渲染进程按需建（见
//   `core/primitives/browser/api/browser.ts::makeBotBrowserProfileId`）建好，主进程只查表。
// · **未绑定的 bot → `defaultProfileId`**（= 今天的 Default）→ 行为与改动前逐字节一致。
// · 本文件不认识 partition 的字符串格式，那件事在 `@core/primitives/browser/api` 里
//   （`browserProfilePartition` / `browserProfileIdFromPartition`），避免两处各写一遍。
import {
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILES,
  browserProfileBotId,
  browserProfilePartition,
  makeBotBrowserProfileId,
  resolveBotBrowserProfileId,
  type BrowserProfile,
} from '@core/primitives/browser/api';
import type { AppSettings } from '@core/services/settings/api';
import { log } from '@main/lib/logger';

type BrowserSettings = AppSettings['browser'];

/**
 * [XG-CUSTOM] 映射表的**只读导出**（派生视图，不是真源）：
 * `~/.xiangwo/bot-browser-map.json` —— 给 agent 侧/人看的「botId → 三处身份」快照：
 *
 *   { "source": "emdash 设置 → 浏览器 → profiles[].botId", "bots": {
 *       "sxsj": { "emdashProfile": "bot-sxsj",
 *                 "emdashPartition": "persist:emdash-browser-profile-bot-sxsj",
 *                 "wegoProfile": "sxsj",
 *                 "learnings": { "global": "~/.wego-lite/learnings",
 *                                "private": "~/.xiangwo/learnings/sxsj" } } } }
 *
 * **真源仍然是 botId**：emdash profile 的绑定写在 emdash 设置里（唯一写入方 = 设置页），
 * `wegoProfile` / 两个 learnings 路径都是**按 botId 派生的约定**（不是第二份可写配置）。
 * 所以这个文件可以随时删、随时重生，删了不影响任何行为。
 */
export function xiangwoBotBrowserMapPath(): string {
  // 可用 `XIANGWO_BOT_MAP_FILE` 覆盖（单测写临时目录 / 运维挪位置用）
  const override = (process.env.XIANGWO_BOT_MAP_FILE ?? '').trim();
  if (override !== '') return override;
  return join(homedir(), '.xiangwo', 'bot-browser-map.json');
}

function writeBotBrowserMapDump(): void {
  const bots: Record<string, Record<string, unknown>> = {};
  for (const profile of profiles) {
    const botId = browserProfileBotId(profile.id, profiles);
    if (botId === undefined) continue;
    bots[botId] = {
      emdashProfile: profile.id,
      emdashProfileName: profile.name,
      emdashPartition: browserProfilePartition(profile.id),
      wegoProfile: botId,
      learnings: {
        global: '~/.wego-lite/learnings',
        private: `~/.xiangwo/learnings/${botId}`,
      },
    };
  }
  const payload = {
    // 生成方式 + 真源声明（人打开这个文件就知道该改哪儿）
    generatedBy: 'emdash settings → browser → profiles[].botId',
    source: 'botId 是唯一真源；本文件是派生导出（可删，会自动重生）',
    defaultProfileId,
    bots,
  };
  const path = xiangwoBotBrowserMapPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (error) {
    // 写不出去（只读 home / 权限）绝不影响设置保存本身 —— 这只是给人看/给 agent 读的副本
    log.warn('[XG-CUSTOM] bot⟷profile 映射导出失败（不影响设置）', { path, error: String(error) });
  }
}

let profiles: readonly BrowserProfile[] = DEFAULT_BROWSER_PROFILES;
let defaultProfileId: string = DEFAULT_BROWSER_PROFILE_ID;

/**
 * `settingsRuntime.setBrowserSettings` 每次落盘都会带着完整 browser 设置进来
 * （wiring.ts / phases/services.ts 两处调用点），这里留一份快照供 9223 桥与反向通道查表。
 */
export function setXiangwoBrowserProfileBindings(browser: BrowserSettings): void {
  profiles =
    Array.isArray(browser.profiles) && browser.profiles.length > 0
      ? browser.profiles
      : DEFAULT_BROWSER_PROFILES;
  defaultProfileId = browser.defaultProfileId ?? DEFAULT_BROWSER_PROFILE_ID;
  // [XG-CUSTOM] 顺手把派生映射表导出给人/agent 看（失败只 warn，绝不影响设置保存）
  writeBotBrowserMapDump();
}

/** 这个 profile 属于哪个 bot（未绑定 → undefined）。`/json/list` 的 `botId` 字段用它。 */
export function xiangwoBotIdForBrowserProfile(profileId: string | undefined): string | undefined {
  if (typeof profileId !== 'string' || profileId === '') return undefined;
  return browserProfileBotId(profileId, profiles);
}

/**
 * 该 bot 用哪个 profile。**永远返回一个具名 profileId**（未绑定/空 botId → defaultProfileId），
 * 这样调用方可以直接拿它跟 `/json/list` 里每个 target 的 `profile` 比，判断"这一页是不是它的"。
 */
export function xiangwoProfileIdForBot(botId: string | undefined): string {
  return resolveBotBrowserProfileId(botId, profiles, defaultProfileId);
}

/**
 * [XG-CUSTOM] 只查"显式绑定"的 profile（未绑定 → null）。
 * 给 9223 桥挑"要复用的那一页"用：没绑定就别去猜 default（否则会和别人的 Default 页串）。
 */
export function xiangwoBoundProfileIdForBot(botId: string | undefined): string | null {
  const wanted = typeof botId === 'string' ? botId.trim() : '';
  if (wanted === '') return null;
  const bound = profiles.find((profile) => browserProfileBotId(profile.id, profiles) === wanted);
  return bound ? bound.id : null;
}

/**
 * [XG-CUSTOM] 该 bot **还没绑定** profile 时，渲染进程会按需建的那个 profileId
 * （[XG-CUSTOM 2026-10-03] 让 `botId` 真的带到新页上）。
 *
 * 为什么需要它：本机实测 `profiles[].botId` 一个都没绑，于是带 botId 的「打开内嵌页」永远落到
 * default（真实配置里甚至 = `isolated-per-task`）→ 每页的 `profile`/`botId` 都是空，
 * agent 分不清"这一页是不是我的"。这里给出**确定性**的 `bot-<botId>`：主进程把它随开页请求
 * 下发 + 当作"要复用哪一页"的判据，渲染进程按同一个 id 真的建出这个 profile（见
 * `core/features/browser/browser/browser-tab-provider.tsx` 的 `onBeforeOpen`），
 * 之后 `/json/list` 就能从 partition 反推出 bot 身份。
 */
export function xiangwoNewBotProfileId(botId: string): string {
  return makeBotBrowserProfileId(botId, profiles);
}

/** [XG-CUSTOM] 设置页要展示"未绑定"提示 / 反向通道判重用。只读快照，调用方别改。 */
export function xiangwoBrowserProfilesSnapshot(): readonly BrowserProfile[] {
  return profiles;
}
