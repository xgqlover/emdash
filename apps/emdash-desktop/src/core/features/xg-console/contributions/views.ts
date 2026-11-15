// [XG-CUSTOM 2026-11-17] 中控台视图（见 emdash/CUSTOMIZATIONS.md）
// 定位：**运行状态**页 —— 在跑谁、跑了多久、端口健康、中控台已注册的流。
// 数据只读 http://localhost:8900/v1/dot/status（票 + flow + health 的唯一真相源），本进程不存副本。
import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const xgConsoleViewDef = defineView({
  id: 'xgConsole',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'xg_console_viewed',
});
