// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
// [XG-CUSTOM 2026-10-03] 「带着 botId 开内嵌页」时要落到哪个 profile —— 纯逻辑，便于单测。
//
// 病根（本机实测）：`profiles[].botId` 一个都没绑 → 带 botId 的「打开内嵌页」全部落到 default
// （真实配置里 defaultProfileId 甚至 = `isolated-per-task`）→ 9223 桥 `/json/list` 里 7 个页的
// `profile`/`botId` 都是空，agent 无法判断"这一页是不是我的"（挑错页 = 串登录态）。
//
// 规则（顺序即优先级）：
//   ① 设置里已经有绑定这个 botId 的 profile → 就用它（唯一真源 = botId）；
//   ② 主进程下发的 `profileId`（确定性 `bot-<botId>`）不在设置里 → **按需建**这个 profile
//      （id 用主进程给的那个，保证主进程"等哪一页"与实际开出来的 partition 一致）；
//   ③ 没带 botId / 拿不到设置 → 完全走老逻辑（`normalizeBrowserProfileSelection`）。
//
// 边界：只在**显式带 botId** 时建 profile —— 人手动开页、老调用方（只发 url）逐字节不变。
import {
  isNamedBrowserProfileId,
  makeBotBrowserProfileId,
  normalizeBrowserBotId,
  normalizeBrowserProfileSelection,
  type BrowserProfile,
} from '@core/primitives/browser/api';

export type OpenProfileResolution = {
  /** 解析后（可能多了新建的那个）的 profile 清单 —— 调用方用它落盘/更新缓存 */
  profiles: readonly BrowserProfile[];
  /** 这次开页要用的 profileId */
  profileId: string;
  /** 需要新加进设置里的 profile（undefined = 无需改设置） */
  createdProfile?: BrowserProfile;
  /** 规范化后的 botId（空串 = 请求没带 / 非法） */
  botId: string;
};

/**
 * [XG-CUSTOM] 2026-10-06 —— auto 建的 bot profile **显示名**：唯一、可辨、零回归。
 *
 * 历史事故（真机 + 数据实证）：`bot-sxsj` 的显示名直接取 `botId`（= `sxsj`），与老的手工
 * profile `sxsj`（未绑定 bot）**撞名** ⇒ 设置页「浏览器配置文件」里两行都叫 `sxsj`，
 * 一行 `id=sxsj`、一行 `id=bot-sxsj`。代码侧取 profile 一律按 **id / botId**（不按名字），所以
 * 功能没坏；但**人**会挑错，也就解释不清"以 sxsj 身份打开却落到另一个 partition"这类现象。
 *
 * 规则：先用 `<botId>`（与改动前一致 ⇒ 无撞名时零回归）；撞名则 `<botId> (bot)`；
 * 再撞则 `<botId> (bot 2)` / `(bot 3)` …
 */
export function uniqueBotProfileName(botId: string, profiles: readonly BrowserProfile[]): string {
  const base = botId.slice(0, 40);
  const taken = new Set(profiles.map((profile) => (profile.name ?? '').trim()));
  if (!taken.has(base)) return base;
  const withBot = `${base.slice(0, 32)} (bot)`;
  if (!taken.has(withBot)) return withBot;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base.slice(0, 28)} (bot ${index})`;
    if (!taken.has(candidate)) return candidate;
  }
  return withBot;
}

export function resolveOpenProfile(input: {
  requestedProfileId?: string;
  botId?: string;
  profiles?: readonly BrowserProfile[];
  defaultProfileId?: string;
}): OpenProfileResolution {
  const botId = normalizeBrowserBotId(input.botId ?? '');
  const profiles = input.profiles;
  const requestedProfileId = (input.requestedProfileId ?? '').trim();
  const fallbackProfileId = normalizeBrowserProfileSelection(
    requestedProfileId !== '' ? requestedProfileId : input.defaultProfileId,
    profiles
  );
  if (botId === '' || profiles === undefined) {
    return { profiles: profiles ?? [], profileId: fallbackProfileId, botId };
  }
  const bound = profiles.find((profile) => (profile.botId ?? '').trim() === botId);
  if (bound !== undefined) {
    return { profiles, profileId: bound.id, botId };
  }
  const wantedProfileId =
    isNamedBrowserProfileId(requestedProfileId) &&
    !profiles.some((profile) => profile.id === requestedProfileId)
      ? requestedProfileId
      : makeBotBrowserProfileId(botId, profiles);
  const createdProfile: BrowserProfile = {
    id: wantedProfileId,
    // [XG-CUSTOM] 2026-10-06 名字要**唯一可辨**：原来直接取 `botId` ⇒ auto 建的 `bot-sxsj` 显示成 `sxsj`，
    //   与老的手工 profile `sxsj` 撞名 —— 设置页出现两行 `sxsj`（一行未绑定、一行绑 sxsj），
    //   人和 agent 都会挑错。规则见 `uniqueBotProfileName`。
    name: uniqueBotProfileName(botId, profiles),
    botId,
  };
  return {
    profiles: [...profiles, createdProfile],
    profileId: wantedProfileId,
    createdProfile,
    botId,
  };
}
