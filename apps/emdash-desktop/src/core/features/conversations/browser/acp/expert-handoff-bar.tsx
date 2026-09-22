import { useCallback, useEffect, useState } from 'react';
import {
  expertHandoffAccept,
  expertHandoffDelete,
  expertHandoffList,
} from '@core/primitives/desktop-host/browser/host-client';
import type { ExpertHandoffTopic } from '@core/primitives/desktop-host/api/host-contract';

/**
 * [XG-CUSTOM] 专家交接台横条：聊天输入框下面的一行，显示待接主题。
 * 样式对齐 MCP 工具调用卡片：横条收拢，点开展开主题列表，每条带「接下 / 删除」。
 * 数据走 host 桥接 → python3 expert_handoff.py list/accept/delete（与 agent.py 后端共用数据）。
 */
export function ExpertHandoffBar({ bot, session }: { bot: string; session: string }) {
  const [topics, setTopics] = useState<ExpertHandoffTopic[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      // session 过滤：后端主题 session 字段目前为空（session_id 传递待修），
      // 这里传空串 → 只取 session 为空的 pending 主题，先跑通 UI。
      const list = await expertHandoffList(bot, session);
      setTopics(Array.isArray(list) ? list : []);
    } catch {
      setTopics([]);
    } finally {
      setBusy(false);
    }
  }, [bot, session]);

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

  if (topics.length === 0 && !busy) return null;

  return (
    <div className="mx-3 mb-1 overflow-hidden rounded-md border border-(--em-border) bg-background/95">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-foreground-muted hover:bg-muted/50"
      >
        <span aria-hidden>📥</span>
        <span>{busy ? '加载中…' : `${topics.length} 个待接主题`}</span>
        <span className="ml-auto text-[10px] text-foreground-muted/70">
          {open ? '收起 ▲' : '展开 ▼'}
        </span>
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-(--em-border)">
          {topics.map((t) => (
            <li key={t.id} className="border-b border-(--em-border) px-2 py-1.5 last:border-b-0">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    [{t.id}] {t.title}
                  </div>
                  {t.summary ? (
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-foreground-muted">
                      {t.summary}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-[10px] text-foreground-muted/60">
                    {t.expert}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => void handleAccept(t.id)}
                    className="rounded bg-(--em-accent) px-2 py-0.5 text-[11px] text-white hover:opacity-90"
                  >
                    接下
                  </button>
                  <button
                    onClick={() => void handleDelete(t.id)}
                    className="rounded border border-(--em-border) px-2 py-0.5 text-[11px] text-foreground-muted hover:bg-muted/50"
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
  );
}
