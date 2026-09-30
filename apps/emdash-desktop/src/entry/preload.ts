import { requestWirePort, type WindowLike } from '@emdash/wire/rpc';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Preload is typechecked by the node program (no DOM lib), but runs in the
// renderer where `window` exists; declare it with the structural type wire needs.
declare const window: WindowLike;

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  requestWirePort: (channel: string) => requestWirePort({ ipcRenderer, window }, { channel }),
  // Boot-watchdog escape hatch. This cannot ride the wire: a hung backend
  // means the wire gateway may never register controllers, so the loading
  // state needs a direct channel to learn the boot is stuck.
  onBootStuck: (callback: (payload: { stuckPhase: string }) => void) => {
    const listener = (_event: unknown, payload: { stuckPhase: string }) => callback(payload);
    ipcRenderer.on('emdash:boot-stuck', listener);
    return () => {
      ipcRenderer.removeListener('emdash:boot-stuck', listener);
    };
  },
  requestBootEscape: (action: 'restart' | 'open-recovery') =>
    ipcRenderer.invoke('emdash:boot-escape', action),
  // Boot report: the splash gate settled, i.e. the usable-workspace moment.
  // The arrival time in main is the measurement.
  reportBootUsable: () => {
    ipcRenderer.send('emdash:boot-usable-workspace');
  },
  // [XG-CUSTOM] CDP 桥接：截图当前浏览器标签页 / 拿当前标签页 URL（浮窗 📷 用）。
  captureCurrentTab: () => ipcRenderer.invoke('xiangwo:capture-current-tab'),
  getCurrentTabUrl: () => ipcRenderer.invoke('xiangwo:get-current-tab-url'),
  // [XG-CUSTOM] 浮窗标志：主进程 additionalArguments 传入（不依赖 URL）。
  isXiangwoFloating: process.argv.includes('--xiangwo-floating'),
  // [XG-CUSTOM] 项我控制球（球态/面板态、拖拽、打开主窗）——见 main/host/xiangwo-orb.ts
  isXiangwoOrb: process.argv.includes('--xiangwo-orb'),
  orbExpand: () => ipcRenderer.invoke('xiangwo:orb-expand'),
  orbCollapse: () => ipcRenderer.invoke('xiangwo:orb-collapse'),
  orbTogglePin: () => ipcRenderer.invoke('xiangwo:orb-toggle-pin'),
  orbDrag: (x: number, y: number) => ipcRenderer.invoke('xiangwo:orb-drag', x, y),
  orbDragEnd: () => ipcRenderer.invoke('xiangwo:orb-drag-end'),
  orbOpenMain: () => ipcRenderer.invoke('xiangwo:orb-open-main'),
  orbQuit: () => ipcRenderer.invoke('xiangwo:orb-quit'),
  getOrbMode: () => ipcRenderer.invoke('xiangwo:orb-mode'),
  // [XG-CUSTOM] 球页面（renderer/orb/orb.js，移植自 deepseek-harness-orb）的唯一宿主 API 入口：
  // 取代 Orb 原来的 fetch('dsh-app://app/api/<method>')，路由在 main/host/xiangwo-orb-api.ts。
  orbApi: (method: string, args?: unknown) => ipcRenderer.invoke('xiangwo:orb-api', method, args),
  onOrbMode: (
    // [XG-CUSTOM] 第三个参数是展开方向：移动会让方向变（球跑到屏幕另一半），渲染进程据此换
    // expand-* 类，保证"页面画的球"和"主进程形状里的球圆"永远在同一个角。
    callback: (
      mode: 'ball' | 'panel',
      pinned: boolean,
      direction: { horizontal: 'left' | 'right'; vertical: 'up' | 'down' } | null
    ) => void
  ) => {
    const listener = (
      _event: unknown,
      mode: 'ball' | 'panel',
      pinned: boolean,
      direction: { horizontal: 'left' | 'right'; vertical: 'up' | 'down' } | null
    ) => callback(mode, pinned, direction);
    ipcRenderer.on('xiangwo:orb-mode', listener);
    return () => {
      ipcRenderer.removeListener('xiangwo:orb-mode', listener);
    };
  },
  // [XG-CUSTOM] 交接台桥接：list / handoff / takeover / complete（调 task-spaces.mjs）。
  taskSpaceList: () => ipcRenderer.invoke('xiangwo:task-space-list'),
  taskSpaceHandoff: (id: string) => ipcRenderer.invoke('xiangwo:task-space-handoff', id),
  taskSpaceTakeover: (id: string) => ipcRenderer.invoke('xiangwo:task-space-takeover', id),
  taskSpaceComplete: (id: string, keep: boolean) => ipcRenderer.invoke('xiangwo:task-space-complete', id, keep),
  // [XG-CUSTOM] 项我球 / 旧浮窗的聊天地址：由主进程解析（本机 / 远程主机 / 复用 SSH 端口转发 /
  // XIANGWO_AGENT_URL 覆盖 / 异常回落 127.0.0.1），渲染进程**不猜主机**。
  // 规则与兜底见 main/host/xiangwo-chat-target.ts，注册见 main/host/window.ts。
  resolveXiangwoChatUrl: () => ipcRenderer.invoke('xiangwo:resolve-chat-url'),
});
