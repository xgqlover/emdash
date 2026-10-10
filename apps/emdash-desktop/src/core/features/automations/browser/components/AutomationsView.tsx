import { EmptyState } from '@emdash/ui/react/components';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] 中文化
import {
  CollectionToolbar,
  CollectionView,
  PageLayout,
  useQueryListSource,
} from '@emdash/ui/react/patterns';
import { Button, Sheet, Tabs, toast } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { Automation } from '@core/primitives/automations/api';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';
import {
  useCurrentViewParams,
  useNavigate,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { formatAutomationError } from '../automation-run-format';
import type { BuiltinAutomationTemplate } from '../automation-template';
import {
  createAutomationsListView,
  type AutomationsListViewModel,
} from '../automations-list-model';
import { emptyStateAutomationTemplates } from '../builtin-catalog';
import { useAutomations, useDeleteAutomation, useUpdateAutomation } from '../use-automations';
import { AutomationDetailView } from './AutomationDetailView';
import { AutomationRow } from './AutomationRow';
import { AutomationTemplatesEmptyState } from './AutomationTemplatesEmptyState';
import { CreateAutomationView } from './CreateAutomationView';
import { KaneoBoardPanel } from './KaneoBoardPanel';
// [XG-CUSTOM 2026-10-10] WorkRally 并入「自动化」：第三个 Tab（照 Kaneo 的先例）
import { WorkRallyPanel } from './WorkRallyPanel';

export function AutomationsView() {
  const automations = useAutomations();
  const update = useUpdateAutomation();
  const destroy = useDeleteAutomation();
  const [creating, setCreating] = useState(false);
  const [initialTemplate, setInitialTemplate] = useState<BuiltinAutomationTemplate | undefined>();
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  // [XG-CUSTOM 2026-10-08] 双 Tab：「自动化」/「Kaneo 看板」
  // —— 让 Kaneo 的活与自动化**在同一个界面**里（卡 = 要做的活，automation = 什么时候做）
  // [XG-CUSTOM 2026-10-10] 第三个 Tab「WorkRally 出图」（用户：「把 WorkRally **并入「自动化」界面**」）。
  // 三个 Tab 就是三条"日常操作"的入口；**配置类**（端点/模式/服务）仍留在 设置→集成，
  // 两边靠按钮互跳（见 WorkRallyPanel 顶部的定位原则）。
  type XgTab = 'automations' | 'kaneo' | 'workrally';
  const [tab, setTab] = useState<XgTab>(() => {
    // 落位：从 设置→集成 的按钮带着 `tab` 参数进来（`navigate(automationsViewDef({ tab: 'workrally' }))`）
    const t = (params as { tab?: unknown } | undefined)?.tab;
    return t === 'kaneo' || t === 'workrally' || t === 'automations' ? t : 'automations';
  });
  const openConfirm = useOpenModal('confirmActionModal');
  const { navigate } = useNavigate();
  const { params, setParams } = useCurrentViewParams(automationsViewDef);

  // [XG-CUSTOM 2026-10-10] 视图**已被挂载**时再次带参数进入（SPA 可能不重挂）⇒ 跟着参数切。
  // 只认显式给的 tab；参数里没有 tab（例如从左侧栏回「自动化」）时**不动**当前 Tab。
  useEffect(() => {
    const t = (params as { tab?: unknown } | undefined)?.tab;
    if (t === 'automations' || t === 'kaneo' || t === 'workrally') setTab(t);
  }, [params]);

  const source = useQueryListSource(automations, (rows: Automation[]) => rows);
  const [view] = useState(() => createAutomationsListView(source));

  const hasAutomations = (automations.data?.length ?? 0) > 0;

  const liveAutomation = params.automationId
    ? (automations.data?.find((a) => a.id === params.automationId) ?? null)
    : null;

  function closeSheet() {
    setParams({ automationId: undefined });
    setCreating(false);
    setInitialTemplate(undefined);
  }

  function openCreateSheet(template?: BuiltinAutomationTemplate) {
    setInitialTemplate(template);
    setCreating(true);
  }

  function handleToggleEnabled(automation: Automation, enabled: boolean) {
    void update.mutateAsync({ id: automation.id, patch: { enabled } });
  }

  function handleDelete(automation: Automation) {
    setPendingDelete(automation);
    closeSheet();
  }

  function handleSheetOpenChangeComplete(open: boolean) {
    if (open || !pendingDelete) return;

    // The sheet is modal and makes sibling portals inert. Wait until it has fully closed before
    // opening the global confirmation dialog so that the dialog remains interactive.
    const automation = pendingDelete;
    setPendingDelete(null);
    void openConfirm({
      title: 'Delete automation',
      description: `"${automation.name}" and its run history will be permanently deleted.`,
      confirmLabel: 'Delete',
    }).then((outcome) => {
      if (outcome.success) {
        void destroy.mutateAsync(automation.id).catch((error) => {
          setParams({ automationId: automation.id });
          toast.error('Could not delete automation', {
            description: formatAutomationError(error),
          });
        });
      } else if (outcome.error.reason === 'explicit') {
        setParams({ automationId: automation.id });
      }
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="h-6 shrink-0 [-webkit-app-region:drag]" />
      <div className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-cols-1 gap-8">
        <div className="relative min-h-0 w-full min-w-0 overflow-y-auto px-8">
          <div className="flex w-full flex-col gap-8 py-8">
            <PageLayout.Header
              title={t('automations')}
              description={t('run_agents_on_schedule')}
            />
            {/* [XG-CUSTOM 2026-10-08] 双 Tab：把 Kaneo 的活放进「自动化」视图。
                用「卡 = 要做的活 / automation = 什么时候自动做」这个分法，
                让用户**在一个界面里看着卡排自动化**（Tab 横向先例见 handoff-view.tsx）。 */}
            <Tabs.Root value={tab} onValueChange={(v) => setTab(v as XgTab)}>
              <Tabs.List>
                <Tabs.Tab value="automations">{t('automations')}</Tabs.Tab>
                <Tabs.Tab value="kaneo">Kaneo 看板</Tabs.Tab>
                {/* [XG-CUSTOM 2026-10-10] WorkRally 出图（日常操作；配置在 设置→集成） */}
                <Tabs.Tab value="workrally">WorkRally 出图</Tabs.Tab>
              </Tabs.List>
            </Tabs.Root>
            {tab === 'kaneo' ? (
              <KaneoBoardPanel />
            ) : tab === 'workrally' ? (
              <WorkRallyPanel />
            ) : (
            <view.Root>
              {/* With zero automations the templates render on the page background —
                  the tiles are cards themselves, so no list card should wrap them. */}
              {!hasAutomations && !automations.isLoading && !automations.isError ? (
                <div className="flex w-full flex-col gap-3">
                  <AutomationsToolbar view={view} onNewAutomation={() => openCreateSheet()} />
                  <AutomationTemplatesEmptyState
                    templates={emptyStateAutomationTemplates}
                    onSelectTemplate={openCreateSheet}
                  />
                </div>
              ) : (
                <CollectionView
                  view={view}
                  renderRow={(automation) => (
                    <AutomationRow
                      automation={automation}
                      onToggleEnabled={(enabled) => handleToggleEnabled(automation, enabled)}
                    />
                  )}
                  estimateSize={68}
                  toolbar={
                    <AutomationsToolbar view={view} onNewAutomation={() => openCreateSheet()} />
                  }
                  onItemClick={(automation) =>
                    navigate(automationsViewDef({ automationId: automation.id }))
                  }
                  // The slot element is built on every render even though it only
                  // shows on error — guard so a null error is never formatted.
                  errorSlot={
                    automations.isError ? (
                      <EmptyState
                        bare
                        label={t('could_not_load_automations')}
                        description={formatAutomationError(automations.error)}
                      />
                    ) : undefined
                  }
                  emptySlot={<EmptyState bare label={t('no_automations_match')} />}
                />
              )}
            </view.Root>
            )}
          </div>
        </div>
      </div>
      <Sheet.Root
        open={liveAutomation !== null || creating}
        onOpenChange={(open) => !open && closeSheet()}
        onOpenChangeComplete={handleSheetOpenChangeComplete}
      >
        <Sheet.Content className="[-webkit-app-region:no-drag]">
          {creating && (
            <CreateAutomationView
              onClose={closeSheet}
              onSaved={closeSheet}
              initialTemplate={initialTemplate}
            />
          )}
          {liveAutomation && (
            <AutomationDetailView
              automation={liveAutomation}
              onClose={closeSheet}
              onDelete={handleDelete}
              onToggleEnabled={handleToggleEnabled}
            />
          )}
        </Sheet.Content>
      </Sheet.Root>
    </div>
  );
}

const AutomationsToolbar = observer(function AutomationsToolbar({
  view,
  onNewAutomation,
}: {
  view: AutomationsListViewModel;
  onNewAutomation: () => void;
}) {
  const search = view.useSearch();
  const searchRef = useSearchFocusHotkeys();
  return (
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        ref={searchRef}
        value={search.query}
        onValueChange={search.setQuery}
        placeholder={t('search_automations')}
      />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Group>
        <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={onNewAutomation}>
          <Plus className="h-3.5 w-3.5" />
          New Automation
        </Button>
      </CollectionToolbar.Group>
    </CollectionToolbar.Root>
  );
});
