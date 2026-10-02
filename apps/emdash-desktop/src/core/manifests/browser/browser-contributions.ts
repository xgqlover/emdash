import { automationsBrowserContributions } from '@core/features/automations/contributions/browser';
import { conversationsBrowserContributions } from '@core/features/conversations/contributions/browser';
import { devPerfBrowserContributions } from '@core/features/dev-perf/contributions/browser';
import { editorBrowserContributions } from '@core/features/editor/contributions/browser';
import { integrationsBrowserContributions } from '@core/features/integrations/contributions/browser';
import { libraryBrowserContributions } from '@core/features/library/contributions/browser';
import { machinesBrowserContributions } from '@core/features/machines/contributions/browser';
import { projectsBrowserContributions } from '@core/features/projects/contributions/browser';
import { settingsBrowserContributions } from '@core/features/settings/contributions/browser';
import { skillsBrowserContributions } from '@core/features/skills/contributions/browser';
import { sourceControlBrowserContributions } from '@core/features/source-control/contributions/browser';
import { tasksBrowserContributions } from '@core/features/tasks/contributions/browser';
import { workbenchBrowserContributions } from '@core/features/workbench/contributions/browser';
// [XG-CUSTOM] 项我视图注册（见 emdash/CUSTOMIZATIONS.md）
import { xiangwoBrowserContributions } from '@core/features/xiangwo/contributions/browser';
import { handoffBrowserContributions } from '@core/features/handoff/contributions/browser';
// [XG-CUSTOM] 专家总览视图注册（见 emdash/CUSTOMIZATIONS.md）
import { expertRosterBrowserContributions } from '@core/features/expert-roster/contributions/browser';

export const featureViewRuntimes = [
  ...workbenchBrowserContributions.views,
  // [XG-CUSTOM] 项我视图
  ...xiangwoBrowserContributions.views,
  ...handoffBrowserContributions.views,
  ...expertRosterBrowserContributions.views,
  ...automationsBrowserContributions.views,
  ...projectsBrowserContributions.views,
  ...settingsBrowserContributions.views,
  ...tasksBrowserContributions.views,
] as const;

export const featureModalDefs = [
  ...conversationsBrowserContributions.modalDefs,
  ...devPerfBrowserContributions.modalDefs,
  ...editorBrowserContributions.modalDefs,
  ...integrationsBrowserContributions.modalDefs,
  ...libraryBrowserContributions.modalDefs,
  ...machinesBrowserContributions.modalDefs,
  ...projectsBrowserContributions.modalDefs,
  ...settingsBrowserContributions.modalDefs,
  ...skillsBrowserContributions.modalDefs,
  ...sourceControlBrowserContributions.modalDefs,
  ...tasksBrowserContributions.modalDefs,
  ...workbenchBrowserContributions.modalDefs,
] as const;
