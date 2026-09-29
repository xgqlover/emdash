// [XG-CUSTOM] 项我侧边聊天浮窗 —— 独立置顶小窗，拖到任意浏览器旁当「侧边聊天框」。
// 后端直接 fetch 8900（[XIANGWO_SOURCE=sidebar] 侧边 suagent 轻量直答）。
// 功能：分 bot 下拉、发图（🖼️）、发文件（📎）、截图当前网页（📷，CDP 桥接）、交接台（📤）。
// 一键组合：主进程 openXiangwoFloating 会同时拉起真实 Chrome（wego-lite CDP）。
import { useEffect, useRef, useState } from 'react';
import type { ComposerAgentOption } from '@emdash/ui/react/components';

type DisplayMsg = { role: 'user' | 'assistant'; text: string; img?: string };
type HistoryMsg = { role: 'user' | 'assistant'; content: unknown };

const BOTS: ComposerAgentOption[] = [
  { id: '', name: '项我' },
  { id: 'sxsj', name: '尚享设计' },
  { id: 'babado', name: 'Babado' },
  { id: 'dayi', name: '大翼' },
  { id: 'shangcha', name: '上茶' },
  { id: 'shuobo', name: '硕博' },
  { id: 'yunyou', name: '云悠' },
  { id: 'chief-engineer', name: '总工' },
  { id: 'ceo', name: 'CEO' },
  { id: 'caiwuzongguan', name: '财务' },
];

type HostBridge = {
  captureCurrentTab?: () => Promise<string>;
  getCurrentTabUrl?: () => Promise<string>;
  taskSpaceList?: () => Promise<unknown>;
  taskSpaceHandoff?: (id: string) => Promise<unknown>;
  taskSpaceTakeover?: (id: string) => Promise<unknown>;
  // [XG-CUSTOM] 控制球（见 main/host/xiangwo-orb.ts）
  isXiangwoOrb?: boolean;
  orbExpand?: () => Promise<unknown>;
  orbCollapse?: () => Promise<unknown>;
  orbTogglePin?: () => Promise<unknown>;
  orbDrag?: (x: number, y: number) => Promise<unknown>;
  orbDragEnd?: () => Promise<unknown>;
  orbOpenMain?: () => Promise<unknown>;
  orbQuit?: () => Promise<unknown>;
  getOrbMode?: () => Promise<[string, boolean]>;
  onOrbMode?: (cb: (mode: 'ball' | 'panel', pinned: boolean) => void) => () => void;
};
const electronAPI = (window as unknown as { electronAPI?: HostBridge }).electronAPI ?? {};

export function XiangwoFloatingPanel() {
  const [display, setDisplay] = useState<DisplayMsg[]>([]);
  const [history, setHistory] = useState<HistoryMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [bot, setBot] = useState('');
  const [attachUrl, setAttachUrl] = useState('');
  const [input, setInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  // [XG-CUSTOM] 球态：ball = 一颗球；panel = 展开面板。由主进程驱动（悬停展开/离开收起/点击固定）
  const isOrb = electronAPI.isXiangwoOrb === true;
  const [orbMode, setOrbMode] = useState<'ball' | 'panel'>(isOrb ? 'ball' : 'panel');
  const [pinned, setPinned] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!isOrb || !electronAPI.onOrbMode) return;
    const off = electronAPI.onOrbMode((mode, isPinned) => {
      setOrbMode(mode);
      setPinned(isPinned);
    });
    void electronAPI.getOrbMode?.().then(([mode, isPinned]) => {
      setOrbMode(mode === 'panel' ? 'panel' : 'ball');
      setPinned(isPinned);
    });
    return off;
  }, [isOrb]);

  async function send(text: string, imgDataUrl?: string) {
    if ((!text.trim() && !imgDataUrl) || loading) return;
    setLoading(true);
    const label = text.trim() || (imgDataUrl ? '（图片）' : '');
    setDisplay((d) => [...d, { role: 'user', text: label, img: imgDataUrl }]);
    try {
      let fullText = text.trim();
      if (bot) fullText = `@${bot} ${fullText}`;
      if (attachUrl) fullText = `${fullText}\n[当前网页] ${attachUrl}`;
      // 纯文本 content 用字符串（OpenAI 格式，agent.py 期望），有图时用数组
      const userContent: unknown = imgDataUrl
        ? [{ type: 'text', text: fullText }, { type: 'image_url', image_url: { url: imgDataUrl } }]
        : fullText;
      const newHistory: HistoryMsg[] = [...history, { role: 'user', content: userContent }];
      const res = await fetch('http://127.0.0.1:8900/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: '[XIANGWO_ROUTE=R0][XIANGWO_SOURCE=sidebar]' }, ...newHistory],
        }),
      });
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const reply = data.choices?.[0]?.message?.content ?? '（无回答）';
      setDisplay((d) => [...d, { role: 'assistant', text: reply }]);
      setHistory([...newHistory, { role: 'assistant', content: reply }]);
      setInput('');
    } catch (e) {
      setDisplay((d) => [...d, { role: 'assistant', text: '调用失败: ' + (e as Error).message }]);
    } finally {
      setLoading(false);
    }
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => void send('', r.result as string);
    r.readAsDataURL(f);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => void send(`[文件 ${f.name}]\n${(r.result as string).slice(0, 8000)}`);
    r.readAsText(f);
  }

  async function onCapture() {
    if (electronAPI.captureCurrentTab) {
      try {
        const b64 = await electronAPI.captureCurrentTab();
        const url = (await electronAPI.getCurrentTabUrl?.()) ?? '';
        setAttachUrl(url);
        await send('', b64);
      } catch (e) {
        setDisplay((d) => [...d, { role: 'assistant', text: '截图失败: ' + (e as Error).message }]);
      }
    } else {
      setDisplay((d) => [...d, { role: 'assistant', text: '（截图桥接未就绪，请说「截图」让 agent 截）' }]);
    }
  }

  async function onHandoff() {
    if (!electronAPI.taskSpaceList) {
      setDisplay((d) => [...d, { role: 'assistant', text: '（交接桥接未就绪）' }]);
      return;
    }
    try {
      const list = (await electronAPI.taskSpaceList()) as Array<{ id: string; name?: string }>;
      if (!list || list.length === 0) {
        setDisplay((d) => [...d, { role: 'assistant', text: '（当前没有可交接的活）' }]);
        return;
      }
      const target = list[0];
      await electronAPI.taskSpaceHandoff?.(target.id);
      setDisplay((d) => [...d, { role: 'assistant', text: `📤 已把「${target.name ?? target.id}」交接到主工作台` }]);
    } catch (e) {
      setDisplay((d) => [...d, { role: 'assistant', text: '交接失败: ' + (e as Error).message }]);
    }
  }

  // [XG-CUSTOM] 球态：只有一颗球。悬停 → 展开面板；单击 → 固定；按住拖 → 移动球（主进程 setBounds）。
  if (isOrb && orbMode === 'ball') {
    return (
      <div
        style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
        onMouseEnter={() => void electronAPI.orbExpand?.()}
        onMouseDown={(e) => {
          dragRef.current = { dx: e.screenX, dy: e.screenY };
        }}
        onMouseMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          if (Math.abs(e.screenX - d.dx) + Math.abs(e.screenY - d.dy) < 4) return; // 抖动阈值
          void electronAPI.orbDrag?.(e.screenX - 36, e.screenY - 36);
        }}
        onMouseUp={() => {
          if (dragRef.current) void electronAPI.orbDragEnd?.();
          dragRef.current = null;
        }}
        onDoubleClick={() => void electronAPI.orbOpenMain?.()}
        title="项我球：悬停展开 · 拖动移动 · 双击打开主窗"
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 32% 28%, #7c9cff 0%, #3b5bdb 55%, #1e2a78 100%)',
            boxShadow: '0 6px 18px rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 22,
            fontWeight: 700,
            cursor: 'grab',
            border: '2px solid rgba(255,255,255,.25)',
          }}
        >
          项
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e2e', color: '#fff' }}
      onMouseLeave={() => {
        if (isOrb && !pinned) void electronAPI.orbCollapse?.();
      }}
    >
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 13, fontWeight: 600, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span>{isOrb ? '🧠 项我球' : '🧠 侧边聊天'}</span>
        <span style={{ flex: 1 }} />
        {isOrb && (
          <button
            onClick={() => void electronAPI.orbCollapse?.()}
            title={pinned ? '已固定（点此收起）' : '收起成球'}
            style={{ padding: '4px 8px', borderRadius: 6, background: pinned ? '#6b8afd' : '#374151', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {pinned ? '📌' : '⊖'}
          </button>
        )}
        <button onClick={() => void onCapture()} title="截图当前网页给 agent" style={{ padding: '4px 8px', borderRadius: 6, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>📷</button>
        <button onClick={() => imgInputRef.current?.click()} title="发图" style={{ padding: '4px 8px', borderRadius: 6, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>🖼️</button>
        <button onClick={() => fileInputRef.current?.click()} title="发文件" style={{ padding: '4px 8px', borderRadius: 6, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>📎</button>
        <button onClick={() => void onHandoff()} title="把当前活交接到主工作台" style={{ padding: '4px 8px', borderRadius: 6, background: '#6b8afd', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>📤 交接</button>
        <input ref={imgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={onPickFile} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {display.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center', paddingTop: 32, fontSize: 13 }}>
            跟项我对话（针对你正在看的网页，可发图 / 发文件 / 📷 截图）
          </div>
        )}
        {display.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            {m.img && <img src={m.img} alt="" style={{ maxWidth: '80%', borderRadius: 8, marginBottom: 4 }} />}
            {m.text && (
              <div style={{
                display: 'inline-block', padding: '6px 10px', borderRadius: 8,
                background: m.role === 'user' ? '#3b82f6' : '#374151', color: '#fff',
                maxWidth: '90%', whiteSpace: 'pre-wrap', textAlign: 'left', fontSize: 13,
              }}>{m.text}</div>
            )}
          </div>
        ))}
        {loading && <div style={{ color: '#888', fontSize: 12 }}>项我思考中...</div>}
      </div>
      {attachUrl && (
        <div style={{ padding: '0 12px 4px', fontSize: 11, color: '#6b8afd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          🔗 已附网页: {attachUrl}
        </div>
      )}
      <div style={{ borderTop: '1px solid #333', padding: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={bot}
          onChange={(e) => setBot(e.target.value)}
          style={{ background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 6, fontSize: 12, padding: '6px 4px', maxWidth: 92 }}
        >
          {BOTS.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="输入消息..."
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #444', background: '#111', color: '#fff', fontSize: 13 }}
        />
        <button onClick={() => void send(input)} disabled={loading} style={{ padding: '8px 14px', borderRadius: 8, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}>发送</button>
      </div>
    </div>
  );
}
