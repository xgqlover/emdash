// [XG-CUSTOM 2026-11-19] `xiangwo-run` 协议：聊天里显示"哪个专家在运行"。
// 形状照 xiangwo-ask 的做法（极简、容错、绝不影响正文）：
//   ```xiangwo-run
//   {"expert":"xg-visual","task":"日本商品搜索","status":"running","ms":0}
//   ```
export type XiangwoRunStatus = 'running' | 'done' | 'fail';

export interface XiangwoRunPayload {
  expert: string;
  task?: string;
  status: XiangwoRunStatus;
  ms?: number;
}

const FENCE = /```xiangwo-run\s*([\s\S]*?)```/;

export function parseXiangwoRunBlock(text: string): {
  text: string;
  run?: XiangwoRunPayload;
} {
  const src = typeof text === 'string' ? text : '';
  const m = FENCE.exec(src);
  if (!m) return { text: src };
  const body = m[1].trim();
  let run: XiangwoRunPayload | undefined;
  try {
    const raw = JSON.parse(body);
    const expert = String(raw?.expert ?? '').slice(0, 60);
    const status = String(raw?.status ?? 'running');
    if (expert && (status === 'running' || status === 'done' || status === 'fail')) {
      run = {
        expert,
        status,
        task: raw?.task ? String(raw.task).slice(0, 80) : undefined,
        ms: Number.isFinite(Number(raw?.ms)) ? Number(raw.ms) : undefined,
      };
    }
  } catch {
    run = undefined;
  }
  // 机器块永不出现在正文里（坏了也剥掉）
  return { text: src.replace(m[0], '').trimEnd(), run };
}
