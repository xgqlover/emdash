import { automationsViewDef } from '@core/features/automations/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { xiangwoViewDef } from '@core/features/xiangwo/contributions/views'; // [XG-CUSTOM]
import { defineViewCatalog } from '@core/primitives/views/api';

export const viewCatalog = defineViewCatalog([
  homeViewDef,
  xiangwoViewDef, // [XG-CUSTOM] 项我主对话入口
  automationsViewDef,
  projectViewDef,
  taskViewDef,
  settingsViewDef,
] as const);

export type ViewId = (typeof viewCatalog.defs)[number]['id'];
