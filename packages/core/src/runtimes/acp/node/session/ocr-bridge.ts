// [XG-CUSTOM 2026-10-30] 入站图桥：image 分片先经 8186 视觉模型转文字，再进 prompt。
// 为什么：本通道模型是 text-only，DSH 会丢 image 分片；项我 8900 那条链路已有同款「视觉预识」。
// 开关：XG_OCR_DISABLE=1 关闭；XG_VISION_URL 覆盖（默认 http://127.0.0.1:8186）。
export type InboundImage = { data: string; mimeType: string };

export async function ocrAttachment(attachment: InboundImage): Promise<string> {
  try {
    if (process.env.XG_OCR_DISABLE === '1') return '';
    const mime = String(attachment?.mimeType || '');
    if (!mime.startsWith('image/') || !attachment?.data) return '';
    const base = String(process.env.XG_VISION_URL || 'http://127.0.0.1:8186').replace(/\/$/, '');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90_000);
    try {
      const res = await fetch(`${base}/v3/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'visone',
          max_tokens: 900,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Please output all text in the image.' },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${attachment.data}` } },
              ],
            },
          ],
        }),
        signal: ctl.signal,
      });
      if (!res.ok) return '';
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = String(data?.choices?.[0]?.message?.content || '');
      if (!raw) return '';
      const refs = Array.from(raw.matchAll(/<ref>([\s\S]*?)<\/ref>/g))
        .map((m) => String(m[1]).trim())
        .filter(Boolean);
      const clean = refs.length
        ? refs.join('\n')
        : raw.replace(/<box>[\s\S]*?<\/box>/g, '').replace(/<\/?ref>/g, '').trim();
      return `\n\n[图片文字（服务端视觉预识，不是用户原话）]\n${clean || raw.trim()}\n`;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return '';
  }
}
