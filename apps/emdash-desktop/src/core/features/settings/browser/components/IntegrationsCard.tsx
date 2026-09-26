import { t } from '@renderer/lib/i18n';
import type { PluginIconAsset } from '@emdash/shared/plugins';
import { Sheet, Tooltip } from '@emdash/ui/react/primitives';
import React, { useState } from 'react';
import { isIssueIntegration } from '@core/features/integrations/api/browser/integration-display';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { supportsIntegrationReconnect } from '@core/manifests/browser/integration-auth-contributions';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { openT8, openWeKnora } from '@core/primitives/desktop-host/browser/host-client';
import type { ConnectionStatus, IssueProviderType } from '@core/primitives/issue-providers/api';
import { IntegrationDetailSidebar } from './IntegrationDetailSidebar';
import { IntegrationGridCard } from './IntegrationGridCard';

export type IntegrationItem = {
  id: IssueProviderType;
  name: string;
  description: string;
  icon: PluginIconAsset;
  features: string[];
  isConfigured: boolean;
  isConfigurationKnown: boolean;
  isMutating: boolean;
  connectionError?: string;
  displayName?: string;
  displayDetail?: string;
  canReconnect: boolean;
  onConnect: () => void;
};

const IntegrationsCard: React.FC = () => {
  const {
    connectionStatus,
    integrationAccounts,
    isLoadingAccounts,
    accountsError,
    integrations: integrationMetadata,
    isIntegrationMutating,
  } = useIntegrationsContext();
  const [selectedProvider, setSelectedProvider] = useState<IssueProviderType | null>(null);
  const openIntegrationSetup = useOpenModal('integrationSetupModal');

  const integrations: IntegrationItem[] = integrationMetadata
    .filter(isIssueIntegration)
    .map((integration) => {
      const provider = integration.id;
      const status: ConnectionStatus = connectionStatus[provider] ?? {
        connected: false,
        capabilities: integration.issueCapabilities,
      };
      const isConfigured = (integrationAccounts[provider]?.length ?? 0) > 0;
      const isConfigurationKnown = !isLoadingAccounts && !accountsError;

      return {
        id: provider,
        name: integration.name,
        description: integration.description,
        icon: integration.icon,
        features: integration.features,
        isConfigured,
        isConfigurationKnown,
        isMutating: isIntegrationMutating(provider),
        connectionError: isConfigured ? status.error : undefined,
        displayName:
          integrationAccounts[provider]?.find((account) => account.isDefault)?.displayName ??
          status.displayName,
        displayDetail: status.displayDetail,
        canReconnect: supportsIntegrationReconnect(integration),
        onConnect: () => void openIntegrationSetup({ integration: provider }),
      };
    });

  const connectedIntegrations = integrations.filter((integration) => integration.isConfigured);
  const availableIntegrations = integrations.filter(
    (integration) => integration.isConfigurationKnown && !integration.isConfigured
  );
  const selectedIntegration = selectedProvider
    ? (integrations.find((integration) => integration.id === selectedProvider) ?? null)
    : null;

  function closeSheet() {
    setSelectedProvider(null);
  }

  return (
    <Tooltip.Provider delay={150}>
      <div className="space-y-8">
        {accountsError ? (
          <p role="alert" className="text-sm text-foreground-error">
            Unable to load accounts. {accountsError.message}
          </p>
        ) : null}
        {connectedIntegrations.length > 0 && (
          <IntegrationSection title={t('connected')}>
            {connectedIntegrations.map((integration) => (
              <IntegrationGridCard
                key={integration.id}
                integration={integration}
                selected={integration.id === selectedProvider}
                onSelect={() => setSelectedProvider(integration.id)}
              />
            ))}
          </IntegrationSection>
        )}

        <IntegrationSection title={t('available')}>
          {availableIntegrations.map((integration) => (
            <IntegrationGridCard
              key={integration.id}
              integration={integration}
              selected={integration.id === selectedProvider}
              onSelect={() => setSelectedProvider(integration.id)}
            />
          ))}
        </IntegrationSection>

        {/* [XG-CUSTOM] WeKnora 入口（非 Issue 集成，点击直接打开 WeKnora 窗口 3010） */}
        <IntegrationSection title="本地工具">
          <button
            type="button"
            onClick={() => void openWeKnora()}
            className="group relative flex w-full items-center gap-4 rounded-lg border border-border bg-background-1 p-4 text-left text-card-foreground transition-all hover:bg-background-2"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background-2 text-2xl">📚</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">WeKnora</span>
              <span className="truncate text-sm text-foreground-muted">本地知识库 / 资料加工台（上传 · 检索 · Wiki）</span>
            </span>
            <span className="text-sm text-foreground-muted">打开 ↗</span>
          </button>
          <button
            type="button"
            onClick={() => void openT8()}
            className="group relative flex w-full items-center gap-4 rounded-lg border border-border bg-background-1 p-4 text-left text-card-foreground transition-all hover:bg-background-2"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background-2 text-2xl">🎨</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">T8 画板</span>
              <span className="truncate text-sm text-foreground-muted">AI 生成工作流引擎（ComfyUI · 图生图 · 视频）</span>
            </span>
            <span className="text-sm text-foreground-muted">打开 ↗</span>
          </button>
        </IntegrationSection>
      </div>

      <Sheet.Root
        open={selectedIntegration !== null}
        onOpenChange={(open) => !open && closeSheet()}
      >
        <Sheet.Content className="[-webkit-app-region:no-drag]">
          {selectedIntegration && (
            <IntegrationDetailSidebar integration={selectedIntegration} onClose={closeSheet} />
          )}
        </Sheet.Content>
      </Sheet.Root>
    </Tooltip.Provider>
  );
};

function IntegrationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-normal text-foreground">{title}</h3>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
      >
        {children}
      </div>
    </section>
  );
}

export default IntegrationsCard;
