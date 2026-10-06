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

// [XG-CUSTOM] Kaneo 窗口（项我流程枢纽，5180）
export async function openKaneo() {
  return (await getHostClient()).openKaneo();
}

// [XG-CUSTOM] AFFiNE 窗口（知识工作台，3010）
export async function openAffine() {
  return (await getHostClient()).openAffine();
}

// [XG-CUSTOM 2026-10-06] OpenDesign 窗口（设计工作台，7456）
export async function openOpenDesign() {
  return (await getHostClient()).openOpenDesign();
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

// [XG-CUSTOM] Pi 树专家名册（专家总览视图）
export async function expertRoster() {
  return (await getHostClient()).expertRoster({});
}

// [XG-CUSTOM] 浏览器工作台（task-spaces）：页面控制权交接，与专家交接台分开的一组
// ⚠️ 这是**另一条**通路：走 Wire（host 域）→ 主机感知的 runXiangwoScript（本机 spawn / 远程 SSH），
//    与 XiangwoFloatingPanel 用的那组 IPC（xiangwo:task-space-*）数据源相同、入口不同。
export async function taskSpaceList() {
  return (await getHostClient()).taskSpaceList({});
}

export async function taskSpaceHandoff(id: string) {
  return (await getHostClient()).taskSpaceHandoff({ id });
}

export async function taskSpaceTakeover(id: string) {
  return (await getHostClient()).taskSpaceTakeover({ id });
}

export async function taskSpaceComplete(id: string, keep: boolean) {
  return (await getHostClient()).taskSpaceComplete({ id, keep });
}

export async function copyTextToClipboard(text: string) {
  return (await getHostClient()).clipboardWriteText({ text });
}
