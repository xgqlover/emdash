import { t } from '@renderer/lib/i18n';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { AgentsSettingsPage } from '../browser/agents-page/AgentsSettingsPage';
import { BrowserSettingsPage } from '../browser/pages/browser-settings-page';
import { GeneralSettingsPage } from '../browser/pages/general-settings-page';
import { IntegrationsSettingsPage } from '../browser/pages/integrations-settings-page';
import { InterfaceSettingsPage } from '../browser/pages/interface-settings-page';
import { RepositorySettingsPage } from '../browser/pages/repository-settings-page';
import type { SettingsPageTab } from './views';

export const generalSettingsPage = defineSettingsPageContribution({
  id: 'general',
  label: t('general'),
  icon: 'settings',
  component: GeneralSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const integrationsSettingsPage = defineSettingsPageContribution({
  id: 'integrations',
  label: t('integrations'),
  icon: 'plug',
  component: IntegrationsSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const interfaceSettingsPage = defineSettingsPageContribution({
  id: 'interface',
  label: t('interface'),
  icon: 'panel-left',
  component: InterfaceSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const browserSettingsPage = defineSettingsPageContribution({
  id: 'browser',
  label: t('browser'),
  icon: 'globe',
  component: BrowserSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const repositorySettingsPage = defineSettingsPageContribution({
  id: 'repository',
  label: t('repository'),
  icon: 'git-branch',
  component: RepositorySettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const agentsSettingsPage = defineSettingsPageContribution({
  id: 'clis-models',
  label: t('agents'),
  icon: 'bot',
  component: AgentsSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);
