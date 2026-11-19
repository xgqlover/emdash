// [XG-CUSTOM 2026-11-19] `xiangwo-ask` 卡片（Solid JSX）：把协议块渲染成可点的问卷。
import { For } from 'solid-js'
import type { XiangwoAskPayload } from '@emdash/shared'

export interface AssistantAskProps {
  ask: XiangwoAskPayload
  onPick?: (answer: string) => void
}

export function AssistantAsk(props: AssistantAskProps) {
  return (
    <div class="xg-ask" data-xg-ask="1">
      <For each={props.ask.title ? [props.ask.title] : []}>
        {(t) => <div class="xg-ask-title">{t}</div>}
      </For>
      <For each={props.ask.questions}>
        {(q, qi) => (
          <div class="xg-ask-q">
            <div class="xg-ask-question">
              {props.ask.questions.length > 1 ? `${qi() + 1}. ` : ''}
              {q.question}
            </div>
            <div class="xg-ask-options">
              <For each={q.options}>
                {(o) => (
                  <button type="button" class="xg-ask-option" onClick={() => props.onPick?.(o)} title={o}>
                    {o}
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
