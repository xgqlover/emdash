// [XG-CUSTOM 2026-11-19] `xiangwo-ask` 协议：跟着 Prime Agent 的 ask_user 形状移植（形状借鉴，MIT）。
//
//   ```xiangwo-ask
//   {"kind":"ask","title":"先确认一下","questions":[{"question":"要找哪个商品？",
//     "options":["百洁布","魔方海绵","其他（自己写）"]}]}
//   ```
//
// 约束（与 ask_user 对齐）：1~3 问、每问 2~7 个选项、问题 ≤200 字、选项 ≤60 字。
// 解析必须容错：坏 JSON / 缺字段 ⇒ 当普通文本（不吞内容）。

export interface XiangwoAskQuestion {
  question: string
  options: string[]
}

export interface XiangwoAskPayload {
  kind: 'ask'
  title?: string
  questions: XiangwoAskQuestion[]
}

const MAX_QUESTIONS = 3
const MAX_OPTIONS = 7
const MAX_Q_LEN = 200
const MAX_OPT_LEN = 60

export function normalizeAsk(raw: unknown): XiangwoAskPayload | undefined {
  try {
    const d = raw as Partial<XiangwoAskPayload> | undefined
    if (!d || !Array.isArray(d.questions)) return undefined
    const questions: XiangwoAskQuestion[] = []
    for (const q of d.questions.slice(0, MAX_QUESTIONS)) {
      const text = String((q as XiangwoAskQuestion)?.question ?? '').trim().slice(0, MAX_Q_LEN)
      const opts = Array.isArray((q as XiangwoAskQuestion)?.options)
        ? (q as XiangwoAskQuestion).options.map((o) => String(o).trim().slice(0, MAX_OPT_LEN)).filter(Boolean).slice(0, MAX_OPTIONS)
        : []
      if (text && opts.length >= 2) questions.push({ question: text, options: opts })
    }
    if (!questions.length) return undefined
    return { kind: 'ask', title: String(d.title ?? '').trim().slice(0, 60) || undefined, questions }
  } catch {
    return undefined
  }
}

/** 从文本里取第一个 xiangwo-ask 块；返回剔除块之后的文本 + 解析结果。 */
export function parseXiangwoAskBlock(text: string): { text: string; ask?: XiangwoAskPayload } {
  try {
    const m = /```xiangwo-ask\s*\n([\s\S]*?)```/.exec(text)
    if (!m) return { text }
    let payload: XiangwoAskPayload | undefined
    try {
      payload = normalizeAsk(JSON.parse(m[1].trim()))
    } catch {
      payload = undefined
    }
    if (!payload) return { text }
    return { text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(), ask: payload }
  } catch {
    return { text }
  }
}
