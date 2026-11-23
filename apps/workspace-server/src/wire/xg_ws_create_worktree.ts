#!/usr/bin/env tsx
/**
 * [XG-CUSTOM 2026-11-21] PilotDeck → emdash workspace backend 的**唯一创建入口**。
 *
 * 为什么是 CLI 而不是让 PilotDeck 直接写 registry：
 *   emdash 的 workspace-server 是 sole writer；PilotDeck 只通过公开 wire 契约
 *   `workspaceRegistry.createWorkspace/createWorktree/deleteWorktree` 操作，
 *   不复制 `workspace_records`、不自己 `git worktree add`。
 *
 * 用法（cwd = emdash 仓根，需 pnpm exec tsx）：
 *   pnpm exec tsx scripts/xg_ws_create_worktree.ts create \
 *     --repo /path/to/bot/repo --run pd-xxx --title "任务名"
 *   pnpm exec tsx scripts/xg_ws_create_worktree.ts remove --workspace <uuid>
 *
 * 输出：一行 JSON（ok/workspaceId/repositoryId/path/branch/cwd 或 error）。
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PROTOCOL_VERSION, workspaceWireContract } from '@emdash/core/workspace-server';
import { client as createClient, connect, streamTransport } from '@emdash/wire/rpc';

function arg(name: string, def = ''): string {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function slugify(s: string): string {
  return (
    s
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

function socketPath(): string {
  return process.env.XG_EMDASH_WS_SOCKET || path.join(os.homedir(), '.emdash/workspace-server/run/workspace.sock');
}

async function connectWire() {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = createConnection(socketPath());
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
  const transport = streamTransport(socket, socket);
  const client = createClient(workspaceWireContract, connect(transport));
  const init = await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    client: { id: 'xg-pilotdeck-bridge', appVersion: '0.0.0' },
  });
  if (!init.success) throw new Error('wire initialize failed: ' + JSON.stringify(init.error));
  return { client, close: () => { transport.close?.(); socket.destroy(); } };
}

// [XG-CUSTOM 2026-11-21] create = 先登记大仓，再走 workspace-server 原生 createWorktree
async function create(): Promise<number> {
  const repo = path.resolve(arg('repo'));
  const run = arg('run', 'pd-' + Date.now());
  const title = arg('title', run);
  const base = arg('base', execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim());
  const slug = slugify(title);
  const short = createHash('sha1').update(repo).digest('hex').slice(0, 8);
  const repoName = slugify(path.basename(repo));
  const root = arg('root', path.join(os.homedir(), 'emdash/worktrees'));
  const dest = path.join(root, `${repoName}-${short}`, slug);
  const branch = arg('branch', `pilotdeck/${slug}-${run.replace(/[^\w.-]+/g, '-')}`);

  const { client, close } = await connectWire();
  try {
    const repoRec = await (client as any).workspaceRegistry.createWorkspace({
      workspaceId: randomUUID(),
      path: repo,
    });
    if (!repoRec.success) throw new Error('createWorkspace failed: ' + JSON.stringify(repoRec.error));
    const ws = await (client as any).workspaceRegistry.createWorktree({
      workspaceId: randomUUID(),
      repositoryId: repoRec.data.id,
      branch,
      baseRef: base,
      path: dest,
    });
    if (!ws.success) throw new Error('createWorktree failed: ' + JSON.stringify(ws.error));
    // [XG 2026-11-23] M6 打点：工作区小仓真建成才记（不阻塞主流程）
    try {
      const { appendFileSync, mkdirSync } = await import("node:fs");
      const { join, dirname } = await import("node:path");
      const p = join(process.env.XG_REPO_ROOT || process.cwd(), "_meta", ".state", "ontology-hits.jsonl");
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, JSON.stringify({ ts: Math.floor(Date.now() / 1000), kind: "M6",
                                         id: "PRC-WORKSPACE-PROVISION" }) + "\n");
    } catch {}

    console.log(
      JSON.stringify({
        ok: true,
        workspaceId: ws.data.id,
        repositoryId: repoRec.data.id,
        path: dest,
        branch,
        cwd: dest,
      })
    );
    return 0;
  } finally {
    close();
  }
}

// [XG-CUSTOM 2026-11-21] remove 只调 deleteWorktree，不手删 registry 行
async function remove(): Promise<number> {
  const workspaceId = arg('workspace');
  if (!workspaceId) throw new Error('missing --workspace');
  const kind = arg('kind', 'worktree');
  const { client, close } = await connectWire();
  try {
    const r =
      kind === 'repository'
        ? await (client as any).workspaceRegistry.deleteWorkspace({ workspaceId })
        : await (client as any).workspaceRegistry.deleteWorktree({ workspaceId, deleteBranch: true });
    if (!r.success) throw new Error('delete failed: ' + JSON.stringify(r.error));
    console.log(JSON.stringify({ ok: true, removed: workspaceId, kind }));
    return 0;
  } finally {
    close();
  }
}

async function main(): Promise<number> {
  const cmd = process.argv[2] || '';
  if (cmd === 'create') return create();
  if (cmd === 'remove') return remove();
  console.error('usage: xg_ws_create_worktree.ts create --repo R --run ID --title T | remove --workspace UUID');
  return 2;
}

main().then(
  (rc) => process.exit(rc),
  (e) => {
    console.log(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    process.exit(1);
  }
);
