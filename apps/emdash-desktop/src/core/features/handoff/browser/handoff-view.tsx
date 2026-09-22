// [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md）
// 侧边栏「交接台」入口 → 完整列表页，列出待接主题，可接下/删除。
// 数据走 host 桥接 → python3 expert_handoff.py list/accept/delete（与 agent.py 后端共用 expert_topics.json）。
import { useCallback, useEffect, useState } from 'react';
import { defineViewRuntime } from '@core/primitives/views/react';
import { handoffViewDef } from '../contributions/views';
import {
  expertHandoffAccept,
  expertHandoffDelete,
  expertHandoffList,
} from '@core/primitives/desktop-host/browser/host-client';
import type { ExpertHandoffTopic } from '@core/primitives/desktop-host/api/host-contract';

export function HandoffMainPanel() {
  const [topics, setTopics] = useState<ExpertHandoffTopic[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const list = await expertHandoffList('', '');
      setTopics(Array.isArray(list) ? list : []);
    } catch {
      setTopics([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAccept = useCallback(
    async (id: number) => {
      try {
        await expertHandoffAccept(String(id));
      } catch {
        /* 忽略 */
      }
      void refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await expertHandoffDelete(String(id));
      } catch {
        /* 忽略 */
      }
      void refresh();
    },
    [refresh]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">交接台</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground-muted hover:bg-background-secondary"
        >
          刷新
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {busy ? (
          <p className="text-sm text-foreground-muted">加载中…</p>
        ) : topics.length === 0 ? (
          <p className="text-sm text-foreground-muted">暂无待接主题</p>
        ) : (
          <ul className="space-y-2">
            {topics.map((t) => (
              <li key={t.id} className="rounded-md border border-border p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      [{t.id}] {t.title}
                    </div>
                    {t.summary ? (
                      <div className="mt-1 text-xs text-foreground-muted">{t.summary}</div>
                    ) : null}
                    <div className="mt-1 text-xs text-foreground-muted/60">{t.expert}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAccept(t.id)}
                      className="rounded-md bg-(--em-accent) px-2.5 py-1 text-xs text-white hover:opacity-90"
                    >
                      接下
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(t.id)}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground-muted hover:bg-background-secondary"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const handoffViewRuntime = defineViewRuntime(handoffViewDef, {
  slots: { main: HandoffMainPanel },
});
