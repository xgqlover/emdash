import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { desktopHostContract, desktopHostDomain } from '../api/host-contract';

export type HostClient = ContractClient<typeof desktopHostContract>;

/** Typed client for the desktop host wire domain (shell, clipboard, dialogs, window). */
export function getHostClient(): Promise<HostClient> {
  return domainClient<HostClient>(desktopHostDomain, desktopHostContract);
}

export async function openExternal(url: string) {
  return (await getHostClient()).openExternal({ url });
}

export async function openXiangwoFloating() {
  return (await getHostClient()).openXiangwoFloating();
}

export async function openWeKnora() {
  return (await getHostClient()).openWeKnora();
}

// [XG-CUSTOM] OpenViking 窗口
export async function openOpenViking() {
  return (await getHostClient()).openOpenViking();
}

export async function openT8() {
  return (await getHostClient()).openT8();
}


// [XG-CUSTOM] 专家交接平台：列前专家主题 / 接下 / 删除
export async function expertHandoffByExpert(expert: string) {
  return (await getHostClient()).expertHandoffByExpert({ expert });
}

export async function expertHandoffAccept(id: string) {
  return (await getHostClient()).expertHandoffAccept({ id });
}

export async function expertHandoffDelete(id: string) {
  return (await getHostClient()).expertHandoffDelete({ id });
}

// [XG-CUSTOM] 新建交接
export async function expertHandoffAdd(bot: string, expert: string, title: string, summary: string, session: string, context: string) {
  return (await getHostClient()).expertHandoffAdd({ bot, expert, title, summary, session, context });
}

export async function expertHandoffList(bot: string, session: string) {
  return (await getHostClient()).expertHandoffList({ bot, session });
}
export async function copyTextToClipboard(text: string) {
  return (await getHostClient()).clipboardWriteText({ text });
}
