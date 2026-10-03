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
    name: botId.slice(0, 40),
    botId,
  };
  return {
    profiles: [...profiles, createdProfile],
    profileId: wantedProfileId,
    createdProfile,
    botId,
  };
}
