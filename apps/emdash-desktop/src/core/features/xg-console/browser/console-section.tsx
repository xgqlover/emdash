// [XG 2026-11-19] 中控台在 Windows 客户端上用，localhost 指客户端自己 ⇒ 默认走服务端 LAN IP，
// 可用 localStorage['xg.dotBase'] 覆盖（例如 http://192.168.1.5:8900）。
const XG_DOT_BASE = (() => {
  try {
    const o = localStorage.getItem('xg.dotBase');
    if (o) return o.replace(/\/$/, '');
  } catch {}
  return 'http://192.168.15.195:8900';
})();

// [XG-CUSTOM 2026-11-17] 右栏第四个折叠块「中控台」：嵌在 变更/已暂存/拉取请求 上面。
// 数据只读 /v1/dot/status（单源，不存副本）；折叠时不轮询。
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@core/primitives/styling/browser/cn';

type Ticket = { owner?: string; stage?: string; age_s?: number; title?: string };
type Status = {
  ok?: boolean; state?: string; working?: Ticket[]; tickets?: Ticket[];
  flows?: string[]; health?: Record<string, boolean>;
  af?: { unanswered_effective?: number; over_count?: number; auto_confirmable?: number };
};

const DOT = `${XG_DOT_BASE}/v1/dot/status`;

export function XgConsoleSection() {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Status | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(DOT, { cache: 'no-store' });
        const j = (await r.json()) as Status;
        if (alive) { setData(j); setErr(''); }
      } catch (e) {
        if (alive) setErr('状态接口不通（8900）');
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [open]);

  const working = data?.working ?? [];
  const badges = Object.entries(data?.health ?? {});
  const af = data?.af;

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="text-sm font-medium">中控台</span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs',
            working.length ? 'bg-success-subtle text-success' : 'bg-surface-subtle text-fg-muted',
          )}
        >
          {working.length ? `在跑 ${working.length}` : '空闲'}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 px-3 pb-2 text-xs text-fg-muted">
          {err && <div className="text-warning">{err}</div>}
          {af && (
            <div className="text-xs text-fg-muted">
              AF 待接 {af.unanswered_effective ?? '?'}（超 7 天 {af.over_count ?? '?'}）
            </div>
          )}
          {working.length === 0 && !err && <div>没有在跑的票</div>}
          {working.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-success">●</span>
              <span className="truncate text-fg">{t.owner ?? '?'}</span>
              <span className="ml-auto shrink-0">{t.age_s ?? 0}s</span>
            </div>
          ))}
          {data?.state === 'running' && !working.length && <div>状态 running，但票未落盘</div>}
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {badges.map(([k, v]) => (
                <span key={k} className={cn('rounded px-1', v ? 'text-success' : 'text-danger')}>
                  {k} {v ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
