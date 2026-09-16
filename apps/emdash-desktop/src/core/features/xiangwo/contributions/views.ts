// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

// 项我主对话视图 —— 主智能入口，直接跟项我（8900）对话
export const xiangwoViewDef = defineView({
  id: 'xiangwo',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'xiangwo_viewed',
});
