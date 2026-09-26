// [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md）
// 【特例·唯一自造】项我「全局主对话」入口：
//   emdash 原生 conversation 必须挂 task（createConversationModal 需要 projectId+taskId），
//   没有"全局主对话"场景。但项我是主智能（所有 bot 的大脑），需要全局视角直接对话，
//   故保留此自造入口。其余聊天（bot 对话）全部走 emdash 原生 acp-chat-panel + ACP。
import { Fragment, useRef, useState } from 'react';
import { defineViewRuntime } from '@core/primitives/views/react';
import { xiangwoViewDef } from '../contributions/views';
import { openExternal, openXiangwoFloating } from '@core/primitives/desktop-host/browser/host-client';

type DisplayMsg = { role: 'user' | 'assistant'; text: string; images: string[]; files: string[] };
type HistoryMsg = { role: 'user' | 'assistant'; content: unknown };

// [XG-CUSTOM] 识别回复里的 [XG-PREVIEW]url[/XG-PREVIEW] 标记 + 裸 http(s) URL，
// 拆成「文本段 / URL 段」，URL 段渲染成可点击链接 → 本机默认浏览器打开（Windows/本机都能用）。
function splitUrls(text: string): { type: 'text' | 'url'; value: string }[] {
  const parts: { type: 'text' | 'url'; value: string }[] = [];
  const regex = /(\[XG-PREVIEW\](.*?)\[\/XG-PREVIEW\]|https?:\/\/[^\s)】]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    const raw = m[0];
    const url = raw.startsWith('[XG-PREVIEW]') ? m[2] : raw;
    parts.push({ type: 'url', value: url });
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

// [XG-CUSTOM] 渲染文本，URL 段显示成可点击链接
function renderText(text: string) {
  const parts = splitUrls(text);
  return parts.map((p, i) =>
    p.type === 'url' ? (
      <a
        key={i}
        href={p.value}
        onClick={(e) => {
          e.preventDefault();
          void openExternal(p.value);
        }}
        style={{ color: '#60a5fa', textDecoration: 'underline', cursor: 'pointer', wordBreak: 'break-all' }}
      >
        {p.value}
      </a>
    ) : (
      <span key={i}>{p.value}</span>
    ),
  );
}

export function XiangwoMainPanel() {
  const [display, setDisplay] = useState<DisplayMsg[]>([]);
  const [history, setHistory] = useState<HistoryMsg[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; data: string; mime: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<'R0' | 'R1' | 'R2'>('R0');
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImages((p) => [...p, reader.result as string]);
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || '';
      setPendingFiles((p) => [...p, { name: f.name, data: base64, mime: f.type }]);
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  async function send() {
    const text = input.trim();
    if ((!text && pendingImages.length === 0 && pendingFiles.length === 0) || loading) return;

    // 构造 user content：文本 + 图片(image_url) + 文件(file)
    const parts: unknown[] = [];
    if (text) parts.push({ type: 'text', text });
    pendingImages.forEach((img) => parts.push({ type: 'image_url', image_url: { url: img } }));
    pendingFiles.forEach((f) => parts.push({ type: 'file', file: { data: f.data, mimeType: f.mime, name: f.name } }));
    const userContent = parts.length === 1 && text ? text : parts;

    setInput('');
    const imgs = [...pendingImages];
    const fls = pendingFiles.map((f) => f.name);
    setPendingImages([]);
    setPendingFiles([]);
    setDisplay((d) => [...d, { role: 'user', text: text || '（图片/文件）', images: imgs, files: fls }]);
    setLoading(true);
    try {
      const newHistory: HistoryMsg[] = [...history, { role: 'user', content: userContent }];
      const res = await fetch('http://localhost:8900/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'system', content: `[XIANGWO_ROUTE=${route}]` }, ...newHistory] }),
      });
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const reply = data.choices?.[0]?.message?.content ?? '（无回答）';
      setDisplay((d) => [...d, { role: 'assistant', text: reply, images: [], files: [] }]);
      setHistory([...newHistory, { role: 'assistant', content: reply }]);
    } catch (e) {
      setDisplay((d) => [...d, { role: 'assistant', text: '调用失败: ' + (e as Error).message, images: [], files: [] }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
        {display.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center', paddingTop: 48 }}>
            🧠 项我（主智能）—— 支持多轮上下文、发图、发文件
          </div>
        )}
        {display.map((m, i) => (
          <div key={i} style={{ marginBottom: 12, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <div
              style={{
                display: 'inline-block',
                padding: '8px 12px',
                borderRadius: 8,
                background: m.role === 'user' ? '#3b82f6' : '#374151',
                color: '#fff',
                maxWidth: '80%',
                whiteSpace: 'pre-wrap',
                textAlign: 'left',
              }}
            >
              {m.images.map((img, j) => (
                <img key={j} src={img} alt="" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 4, marginBottom: 6, display: 'block' }} />
              ))}
              {m.files.map((fn, j) => (
                <div key={j} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>📄 {fn}</div>
              ))}
              {renderText(m.text)}
            </div>
          </div>
        ))}
        {loading && <div style={{ color: '#888' }}>项我思考中...</div>}
      </div>

      {pendingImages.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {pendingImages.map((img, i) => (
            <img key={i} src={img} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }} />
          ))}
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {pendingFiles.map((f, i) => (
            <span key={i} style={{ fontSize: 12, color: '#cbd5e1', background: '#374151', padding: '2px 8px', borderRadius: 4 }}>
              📄 {f.name}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onImage}
        />
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={onFile}
        />
        <button
          onClick={() => void openXiangwoFloating()}
          title="弹出侧边聊天浮窗（置顶小窗，可拖到浏览器旁）"
          style={{ padding: '8px', borderRadius: 8, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          💬
        </button>
        <select
          value={route}
          onChange={(e) => setRoute(e.target.value as 'R0' | 'R1' | 'R2')}
          title="路由模式"
          style={{ padding: '8px', borderRadius: 8, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          <option value="R0">R0 直答</option>
          <option value="R1">R1 蜂群</option>
          <option value="R2">R2 专家</option>
        </select>
        <button
          onClick={() => imgRef.current?.click()}
          title="发图"
          style={{ padding: '8px', borderRadius: 8, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          🖼️
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          title="发文件"
          style={{ padding: '8px', borderRadius: 8, background: '#374151', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          📎
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="输入消息，跟项我对话...（Enter 发送）"
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #444',
            background: '#1e1e2e',
            color: '#fff',
          }}
        />
        <button
          onClick={() => void send()}
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}

export const xiangwoViewRuntime = defineViewRuntime(xiangwoViewDef, {
  slots: { wrap: Fragment, main: XiangwoMainPanel },
});
