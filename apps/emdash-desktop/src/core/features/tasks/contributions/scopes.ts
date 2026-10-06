import { z } from 'zod';
// [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（browser.openUrl）：名字带 browser. 前缀（命令归 browser slice），
//   但**执行体绑在 task view scope 上** —— 只有这里拿得到「当前 task」，开页也只走它的 paneLayout。
import { browserOpenUrlCommand } from '@core/features/browser/contributions/commands';
import { defineViewScope } from '@core/primitives/view-scopes/api';
import { TASK_COMMAND_DEFS, TASK_LIST_COMMAND_DEFS } from './commands';

export const taskViewScope = defineViewScope({
  id: 'view.task',
  params: z.object({
    projectId: z.string().min(1),
    taskId: z.string().min(1),
  }),
  // [XG-CUSTOM] 2026-10-06 —— 追加 browser.openUrl（实现见 tasks/browser/task-scope.tsx）
  commands: [...TASK_COMMAND_DEFS, browserOpenUrlCommand],
  activation: 'logical',
  key: ({ projectId, taskId }) => `${projectId}:${taskId}`,
});

export const taskListScope = defineViewScope({
  id: 'task.list',
  params: z.object({ projectId: z.string().min(1) }),
  commands: TASK_LIST_COMMAND_DEFS,
  activation: 'focus',
  key: ({ projectId }) => projectId,
});
