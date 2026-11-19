// [XG-CUSTOM 2026-11-19] `xiangwo-run` 卡片（Solid JSX）：显示"哪个专家在运行/完成/失败"。
import type { XiangwoRunPayload } from '@emdash/shared'

export interface AssistantRunProps {
  run: XiangwoRunPayload
}

const LABEL: Record<string, string> = { running: '运行中', done: '完成', fail: '失败' }
const DOT: Record<string, string> = { running: '●', done: '✓', fail: '✕' }

export function AssistantRun(props: AssistantRunProps) {
  const p = () => props.run
  return (
    <div class="xg-run" data-xg-run="1" data-status={p().status}>
      <span class="xg-run-dot">{DOT[p().status] ?? '●'}</span>
      <span class="xg-run-label">{LABEL[p().status] ?? p().status}</span>
      <span class="xg-run-expert">{p().expert}</span>
      {p().task ? <span class="xg-run-task">· {p().task}</span> : null}
      {p().ms ? <span class="xg-run-ms">{(p().ms! / 1000).toFixed(1)}s</span> : null}
    </div>
  )
}
