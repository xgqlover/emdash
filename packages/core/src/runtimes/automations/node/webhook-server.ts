// [XG-CUSTOM 2026-10-05] **事件触发摄取端 automation-webhook-server**（第 3 项 · 第二切片）
//
// 职责单一：**只做"把 HTTP 事件安全地收进来 + 过滤 + 回调"**。它不碰调度/不碰数据库 ——
// 命中后交给调用方去 `scheduler.runNow(deployment, 'webhook')`（那条路第一切片已经就位）。
//
// 安全姿态**照抄仓库既有的 `TuiHookServer`**（`runtimes/tui-agents/node/hooks/hook-server.ts`），
// 并加上"每个 automation 一个 token"这一层：
//   ① **只绑 127.0.0.1**（绝不对外监听）；
//   ② **默认不起监听**：`listTargets()` 为空 → `ensureStarted()` 返回 null（没有 webhook automation
//      就绝不占端口，用户机器上不会平白多一个监听）；
//   ③ **token 常量时间比较**（`crypto.timingSafeEqual`，长度不同也不抛）；
//   ④ 路径/方法不对 404、缺 token 401、token 不对 403、JSON 坏 400、body 超 1MB 413；
//   ⑤ 过滤不匹配 → **204（收到但不跑）**；命中 → **202**（已受理，具体跑没跑由调度决定）。
//
// 端口策略（本切片定的默认，可在调用方覆盖）：`127.0.0.1:7823`，可用
// `EMDASH_AUTOMATION_WEBHOOK_PORT` 覆盖（固定端口的理由：外部脚本/git hook 要能写死地址）。
//
// 回归测试见 ./webhook-server.test.ts

import crypto from 'node:crypto';
import http from 'node:http';
import type { Logger } from '@emdash/shared/logger';
import { matchWebhookFilter } from './scheduling/webhook-filter';

export const AUTOMATION_WEBHOOK_DEFAULT_PORT = 7823;
export const AUTOMATION_WEBHOOK_MAX_BODY_BYTES = 1_000_000;
export const AUTOMATION_WEBHOOK_PATH_PREFIX = '/automation/';
export const AUTOMATION_WEBHOOK_TOKEN_HEADER = 'x-emdash-automation-token';

/** 一个可被事件触发的目标（由调用方从"已启用的 webhook automation"生成） */
export type WebhookTarget = {
  automationId: string;
  token: string;
  /** 受限过滤表达式（`undefined`/空 = 全匹配）。见 `scheduling/webhook-filter.ts` */
  filter?: string;
};

export type WebhookIntake = {
  /** 当前目标（空数组 ⇒ 不起监听） */
  listTargets: () => WebhookTarget[];
  /** 事件命中（过滤通过）→ 调用方去触发 run */
  onEvent: (target: WebhookTarget, payloadText: string, payload: unknown) => void;
  logger: Logger;
  /** 默认 `AUTOMATION_WEBHOOK_DEFAULT_PORT`；测试传 0 让系统分配 */
  port?: number;
  maxBodyBytes?: number;
};

/** 常量时间比较（长度不同直接失败，不抛） */
function tokenEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 纯请求处理器（导出以便单测直接构造 req/res；也便于将来挂到别的 HTTP 服务上）。
 * 返回 true = 已受理（写响应由本函数负责）。
 */
export function createAutomationWebhookHandler(
  intake: WebhookIntake
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const maxBody = intake.maxBodyBytes ?? AUTOMATION_WEBHOOK_MAX_BODY_BYTES;

  return (req, res) => {
    const url = req.url ?? '';
    if (req.method !== 'POST' || !url.startsWith(AUTOMATION_WEBHOOK_PATH_PREFIX)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const automationId = decodeURIComponent(url.slice(AUTOMATION_WEBHOOK_PATH_PREFIX.length));
    const target = intake
      .listTargets()
      .find((candidate) => candidate.automationId === automationId);
    if (target === undefined) {
      // 不暴露"这个 id 存不存在"：未知 id 与坏 token 一样都是 403
      intake.logger.warn('AutomationWebhook: unknown automation id');
      res.writeHead(403);
      res.end();
      return;
    }
    const provided = String(req.headers[AUTOMATION_WEBHOOK_TOKEN_HEADER] ?? '');
    if (provided === '') {
      res.writeHead(401);
      res.end();
      return;
    }
    if (!tokenEquals(target.token, provided)) {
      intake.logger.warn('AutomationWebhook: rejected request with invalid token');
      res.writeHead(403);
      res.end();
      return;
    }

    let body = '';
    let oversized = false;
    req.on('data', (chunk: Buffer) => {
      if (oversized) return; // 已经回过 413：继续把剩余数据吞掉，别半路断连
      body += chunk.toString();
      if (body.length > maxBody) {
        oversized = true;
        body = '';
        res.writeHead(413);
        res.end();
        // ⚠️ **不要 `req.destroy()`**：实测立刻断开会变成 `UND_ERR_SOCKET: other side closed`，
        //    客户端根本收不到那个 413（仓库既有的 TuiHookServer 就是 destroy，同款症状）。
        //    这里改为"回完 413 继续排空请求体"，让调用方能看见明确的状态码。
      }
    });
    req.on('end', () => {
      if (oversized) return; // 413 已发
      let payload: unknown;
      try {
        payload = body.trim() === '' ? {} : JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (!matchWebhookFilter(target.filter, payload)) {
        // 收到但过滤不匹配（**fail-closed**：畸形表达式同样落到这里）
        res.writeHead(204);
        res.end();
        return;
      }
      try {
        intake.onEvent(target, body, payload);
      } catch (error) {
        intake.logger.warn('AutomationWebhook: onEvent failed', { error: String(error) });
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(202);
      res.end();
    });
  };
}

/** 薄薄一层的服务器壳：只在有目标时才监听 */
export class AutomationWebhookServer {
  private server: http.Server | null = null;
  private port = 0;
  private starting: Promise<{ port: number } | null> | null = null;

  constructor(private readonly intake: WebhookIntake) {}

  get listeningPort(): number {
    return this.port;
  }

  async ensureStarted(): Promise<{ port: number } | null> {
    if (this.intake.listTargets().length === 0) {
      this.stop(); // 没有目标 → 确保不留监听
      return null;
    }
    if (this.server !== null && this.port > 0) return { port: this.port };
    if (this.starting !== null) return this.starting;

    const handler = createAutomationWebhookHandler(this.intake);
    this.server = http.createServer((req, res) => handler(req, res));

    this.starting = new Promise<{ port: number } | null>((resolve, reject) => {
      const desired = this.intake.port ?? AUTOMATION_WEBHOOK_DEFAULT_PORT;
      this.server!.listen(desired, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address !== null && typeof address === 'object') this.port = address.port;
        this.intake.logger.info('AutomationWebhook: started', { port: this.port });
        resolve({ port: this.port });
      });
      this.server!.on('error', (error) => {
        // 端口占用等：**不抛给调用方**（桌面应用不该因为一个可选能力起不来）
        this.intake.logger.warn('AutomationWebhook: failed to start', { error: String(error) });
        this.stop();
        resolve(null);
      });
      void reject;
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  stop(): void {
    if (this.server !== null) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }
}
