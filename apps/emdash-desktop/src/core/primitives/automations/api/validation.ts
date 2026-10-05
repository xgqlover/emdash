import { Cron } from 'croner';
import type { TriggerConfig } from './config';
import { getLocalTimeZone } from './timezone';

export function assertValidCronTrigger(trigger: TriggerConfig): void {
  // [XG-CUSTOM 2026-10-05] expr 在 webhook 触发里可为空 → cron 校验先判存在
  const expr = (trigger.expr ?? '').trim();
  if (!expr) throw new Error('cron_invalid');
  if (expr.split(/\s+/).length !== 5) throw new Error('cron_invalid');

  try {
    const nextRun = new Cron(expr, { timezone: trigger.tz || getLocalTimeZone() }).nextRun(
      new Date()
    );
    if (!nextRun) throw new Error('cron_invalid');
  } catch {
    throw new Error('cron_invalid');
  }
}
