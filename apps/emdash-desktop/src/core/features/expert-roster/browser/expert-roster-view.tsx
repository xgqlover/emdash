// [XG-CUSTOM] 专家总览视图（见 emdash/CUSTOMIZATIONS.md）
// 侧边栏「专家总览」→ Pi 树 81 个身份按 kind 分组，带主题数/待接/已接，没活的置灰折叠。
// 数据走 host 桥接 → python3 expert_roster.py roster（hostAwareSpawn，Windows 远程也通）。
import { PageLayout } from '@emdash/ui/react/patterns';
import { Badge, Button, toast } from '@emdash/ui/react/primitives';
import { ChevronDown, ChevronRight, RefreshCw, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  ExpertRosterEntry,
  ExpertRosterResult,
} from '@core/primitives/desktop-host/api/host-contract';
import { expertRoster } from '@core/primitives/desktop-host/browser/host-client';
import { cn } from '@core/primitives/styling/browser/cn';
import { defineViewRuntime } from '@core/primitives/views/react';
import { expertRosterViewDef } from '../contributions/views';

const KIND_LABEL: Record<string, string> = {
  main: '主 bot（大包仓）',
  sub: '子代理（小包仓）',
  role: '通用角色（项我小仓）',
  expert: '专家池',
  other: '未归类',
};

function relTime(ts: number): string {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

// 单行：身份 + 主题数；没主题的置灰
function RosterRow({ item }: { item: ExpertRosterEntry }) {
  const idle = item.topics === 0;
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2',
        idle && 'opacity-50'
      )}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
      <span className="shrink-0 font-mono text-xs text-foreground-muted">{item.id}</span>
      <span className="flex shrink-0 items-center gap-1">
        {item.pending > 0 && <Badge variant="soft" tone="info">待接 {item.pending}</Badge>}
        {item.accepted > 0 && <Badge variant="soft" tone="success">已接 {item.accepted}</Badge>}
        {item.topics === 0 && <span className="text-xs text-foreground-muted">无主题</span>}
      </span>
      <span className="w-20 shrink-0 text-right text-xs text-foreground-muted">
        {relTime(item.lastActive)}
      </span>
    </div>
  );
}

function ExpertRosterMainPanel() {
  const [data, setData] = useState<ExpertRosterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ role: true, expert: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await expertRoster()) as ExpertRosterResult;
      setData(r);
    } catch (e) {
      toast.error('读取专家名册失败', { description: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals;
  return (
    <PageLayout className="h-full">
      <PageLayout.Header
        title="专家总览"
        description={
          totals
            ? `${totals.identities} 个身份 · ${totals.identitiesWithWork} 个有主题 · 共 ${totals.topics} 条（待接 ${totals.pending} / 已接 ${totals.accepted}）`
            : 'Pi 树全量身份与负载'
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />
      <PageLayout.Content className="space-y-4 overflow-auto p-4">
        {data?.registryError && (
          <div className="rounded-md border border-border-danger bg-background-danger px-3 py-2 text-sm text-foreground-danger">
            suagent_registry 未加载：{data.registryError}
          </div>
        )}
        {!data && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Users className="size-4" />
            {loading ? '读取中…' : '暂无数据'}
          </div>
        )}
        {(data?.groups ?? []).map((g) => {
          const isCollapsed = collapsed[g.kind] ?? false;
          const withWork = g.items.filter((i) => i.topics > 0).length;
          return (
            <div key={g.kind} className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left text-sm font-medium"
                onClick={() => setCollapsed((c) => ({ ...c, [g.kind]: !isCollapsed }))}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                {KIND_LABEL[g.kind] ?? g.kind}
                <span className="text-xs text-foreground-muted">
                  {g.items.length} 个 · {withWork} 个有主题
                </span>
              </button>
              {!isCollapsed && (
                <div className="space-y-1">
                  {g.items.map((it) => (
                    <RosterRow key={it.id} item={it} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </PageLayout.Content>
    </PageLayout>
  );
}

export const expertRosterViewRuntime = defineViewRuntime(expertRosterViewDef, {
  slots: { wrap: ({ children }) => <>{children}</>, main: ExpertRosterMainPanel },
});
