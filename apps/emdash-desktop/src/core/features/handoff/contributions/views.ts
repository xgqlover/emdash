// [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md）
import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

// 专家交接台 —— 侧边栏「交接台」入口，列出待接主题，可接下/删除
export const handoffViewDef = defineView({
  id: 'handoff',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'handoff_viewed',
});
