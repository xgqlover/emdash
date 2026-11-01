import React from 'react';
import { useSettingsSearch } from '@core/features/settings/browser/search/settings-search-context';
import { AgentsPanel } from '@core/features/settings/contributions/browser/agents-page/AgentsPanel';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export function AgentsSettingsPage() {
  const { query: settingsSearchQuery, setQuery: setSettingsSearchQuery } = useSettingsSearch();

  return (
    <AgentsPanel
      header={{ title: 'Agents', description: t('manage_agents_and_model_configurations') }}
      searchQuery={settingsSearchQuery}
      onSearchQueryChange={setSettingsSearchQuery}
    />
  );
}
