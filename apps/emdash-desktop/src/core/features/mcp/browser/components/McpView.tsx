import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import React from 'react';
import { McpPanel } from '@core/features/mcp/contributions/browser/McpPanel';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export const McpView: React.FC = () => (
  <McpPanel
    host={LOCAL_HOST_REF}
    header={{
      title: 'MCP',
      description: t('connect_your_agents_with_external_data_s'),
    }}
  />
);
