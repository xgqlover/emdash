import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const automationsViewDef = defineView({
  id: 'automations',
  params: z.object({
    automationId: z.string().optional(),
    // [XG-CUSTOM 2026-10-10] 用户原话：「**要结合集成与自动化，有些地方要到集成里调的话，
    // 就搞个按钮一点就进入集成里改**」。反向同理 —— 设置→集成 里的 WorkRally 卡要能
    // **一点就落到这个 Tab**，所以 params 得能表达"落在哪个 Tab"。
    // ⚠️ 为什么用**已存在的视图 params** 而不是新造路由：本仓 tab 状态原本是组件内 useState，
    //    没有任何外部可达路径；params 是本视图**唯一**的对外入参通道（`useCurrentViewParams` 读它）。
    // 可选 + 默认不传 ⇒ **老调用方零回归**。
    tab: z.enum(['automations', 'kaneo', 'workrally']).optional(),
  }),
  layout: workbenchLayout,
  telemetryEvent: 'automations_viewed',
});
