// [XG-CUSTOM 2026-10-05] **主界面「可被球 / agent 指挥」的命令白名单 —— 唯一事实源**。
//
// 为什么要它（用户 2026-10-05 要求）：「**球要用到的网页，跟别的功能主界面要同步支持**」。
//   查实现状：主界面有 **22 个功能区 / 350 个命令**（`@core/primitives/commands/api` 的 typed
//   `CommandCatalog` + palette + 渲染侧 `keybindingDispatcher`），而球只够得着 **5 个** method。
//   ⇒ 正确做法**不是给每个功能单开一条 IPC**（那必然两边漂移），而是：
//      **以主界面已有的命令目录为事实源，只把它标记为「允许外部触发」的子集暴露出去。**
//   这样主界面加/改命令时，球与 agent 自动可见 —— **结构上不存在两边各写一份**。
//
// 🔴 三条硬约束（改这里之前先读）：
//   ① **默认不可触发**：只有本表里的 id 能被球/agent 执行；表外一律拒（`unknown-command`）。
//   ② **写类必须走审批**：`kind: 'write'` 的动作（新建任务 / 改配置 …）**不能直接执行**，
//      必须经用户批准（复用 `xg_mcp_approval` 那套闸门语义）—— `requiresApproval()` 是判据。
//   ③ **只放「命令 id」**：绝不暴露任意 IPC 频道 / 任意 renderer 代码（那就等于把整个 app 交出去）。
//
// 判据：本表每个 id 都必须**真实存在于主界面命令目录**（集成测试断言 ⊆ catalog，见 §TODO）。

export type HostCommandKind = 'read' | 'write';

export interface HostCommandSpec {
  /** 主界面命令 id（必须真实存在，如 `app.settings`） */
  readonly id: string;
  /** 给球/agent 看的人话标题 */
  readonly title: string;
  /** read = 直接执行；write = 必须用户批准 */
  readonly kind: HostCommandKind;
  /** 可选：给模型的使用提示（什么时候该用它） */
  readonly hint?: string;
}

export const HOST_COMMANDS: readonly HostCommandSpec[] = Object.freeze([
  {
    id: 'app.commandPalette',
    title: '打开命令面板',
    kind: 'read',
    hint: '用户想「找某个功能/命令」但说不清名字时，打开面板让他自己挑（比猜命令好）。',
  },
  {
    id: 'app.settings',
    title: '打开设置',
    kind: 'read',
    hint: '用户要改配置（模型/权限/快捷键…）时用它，别自己改配置文件。',
  },
  {
    id: 'app.navigateBack',
    title: '后退',
    kind: 'read',
  },
  {
    id: 'app.navigateForward',
    title: '前进',
    kind: 'read',
  },
  {
    id: 'view.task',
    title: '切到任务视图',
    kind: 'read',
    hint: '用户要看任务/工作台内容时用它。',
  },
  {
    id: 'app.toggleTheme',
    title: '切换主题（明/暗）',
    kind: 'read',
  },
  {
    id: 'app.newTask',
    title: '新建任务',
    kind: 'write',
    hint: '**写类**：会真的建任务，必须用户批准。',
  },
  {
    id: 'app.newProject',
    title: '新建项目',
    kind: 'write',
    hint: '**写类**：会真的建项目，必须用户批准。',
  },
]);

/** 全部可暴露命令（给球/agent 看的清单）。 */
export function listHostCommands(): HostCommandSpec[] {
  return HOST_COMMANDS.map((c) => ({ ...c }));
}

/** 按 id 查（表外 → undefined）。 */
export function findHostCommand(id: string): HostCommandSpec | undefined {
  const key = (id ?? '').trim();
  if (key === '') return undefined;
  return HOST_COMMANDS.find((c) => c.id === key);
}

export function isHostCommand(id: string): boolean {
  return findHostCommand(id) !== undefined;
}

/** 🔴 写类必须用户批准（读类可直接执行）。表外的 id 也返回 true —— **默认从严**。 */
export function requiresApproval(id: string): boolean {
  const spec = findHostCommand(id);
  if (spec === undefined) return true;
  return spec.kind === 'write';
}
