// [XG-CUSTOM] 专家总览视图（见 emdash/CUSTOMIZATIONS.md）
// 侧边栏「专家总览」→ Pi 树全量身份（主 bot / 子代理 / 通用角色 / 专家池）+ 各自主题数。
// 定位：Kaneo 只放「有工作」的 bot（A 方案），全量身份可见性放这里，两边分工不打架。
import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const expertRosterViewDef = defineView({
  id: 'expertRoster',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'expert_roster_viewed',
});
