#!/usr/bin/env node
// [XG-CUSTOM] emdash 定制台账 / 检查器 —— 解决「上游一更新，改过的东西别全丢了」
//
//   node scripts/xg-custom/check.mjs --gen          # 重新生成台账 manifest.json（幂等：同一 HEAD 两次生成字节一致）
//   node scripts/xg-custom/check.mjs --check        # 与上游比对：漏标告警 + 上游风险（有问题退出码 1，可进 CI）
//   node scripts/xg-custom/check.mjs --list         # 打印台账（按文件分组 + 行号 + 一句话说明 + 当前实际标记数）
//   node scripts/xg-custom/check.mjs --after-merge  # 合并/rebase 上游之后跑：报告**哪些定制点丢了** + 从哪个提交能捞回来
//
//   可选：--base <sha>（默认 git merge-base HEAD origin/main）  --upstream <ref>（默认 origin/main）
//         --no-color   --limit <n>（列表截断长度，默认 25）
//
// 设计取舍（核心）：**以标记为锚点，hash 只作辅助**
//   上游 rebase / merge 之后，凡是我们定制过的文件：blob hash 必然全变（行号也会整体漂移），
//   所以「hash 一致」绝不能当「定制还在」的判据。判据按优先级：
//     ① 文件级：这个文件现在还有没有 [XG-CUSTOM] 标记
//     ② 行级锚点：每个标记「守着的那行代码」（anchor，已归一化空白、不含行号）还在不在
//        —— 上游若把这段代码删了/重写了，anchor 就对不上 → 报「定制点疑似丢失」
//     ③ hash：只用来区分「文件一字未动」还是「上游改了周边代码」→ 决定要不要跑 --gen 刷新台账
//   台账里的 lines[] 只是展示辅助（生成时行号，rebase 后必然漂移）；
//   找回提交走 `git log -S'[XG-CUSTOM]' -- <file>`（按内容找，不依赖行号）。
//
// 为什么台账自身目录不入账：manifest.json 里会引用 [XG-CUSTOM] 文本（工具说明/锚点），
//   入账会让 --gen 变成自指（生成结果依赖生成结果）→ 台账就不幂等了。
// 为什么 *.md 不入账：文档是给人读的清单（CUSTOMIZATIONS.md 由别的会话维护，加标记会打架），
//   且文档没有「代码定制点」可锚。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const MANIFEST = join(HERE, 'manifest.json');
const MARKER = '[XG-CUSTOM]';

const CFG = {
  // 台账自身目录：不入账（自指问题，见文件头）
  selfPrefix: 'scripts/xg-custom/',
  // 文档不入账（人读清单，不是代码定制点）
  docRe: /\.md$/i,
  // 噪音：不参与「漏标」统计（否则 459 个被提交进仓库的打包缓存会把报告淹掉）
  noiseRe: [
    /^pnpm-lock\.yaml$/,
    /^\.github\/electron-builder-(cache|bin)\//,
    /(^|\/)(out|dist|release|node_modules)\//,
  ],
  // 噪音行：版本号/包管理器这类「跟着 fork 走」的配置，命中定制特征但不算漏标
  trivialRe: [/^\s*"version"\s*:/, /^\s*"packageManager"\s*:/, /^\s*"name"\s*:/],
  // 「定制证据」：diff 命中即高度怀疑是本仓定制（而不是上游自己的改动）
  evidence: [
    /@renderer\/lib\/i18n/,
    /xiangwo/i,
    /XG-CUSTOM/,
    /xg-(i18n|custom)/i,
    /expert[-_]handoff/i,
    /OpenViking/,
    /WeKnora/,
    /HippoBuddy/,
    /\bT8\b/,
    /:(8900|9223|9037|1933|8083|19224)\b/,
  ],
  // note：按路径前缀最长匹配（人工维护这张表，manifest 仍然全自动生成）
  noteOverrides: [
    ['scripts/xg-i18n/', '中文化台账 + 还原器 apply.mjs'],
    ['apps/emdash-desktop/src/renderer/lib/i18n/', '中文化语言包（zh/en 双包）'],
    ['apps/emdash-desktop/src/renderer/orb/', '项我球 orb（球壳 + 聊天/图片网格渲染）'],
    ['apps/emdash-desktop/src/renderer/XiangwoFloatingPanel.tsx', '旧浮窗（与球共用聊天通道）'],
    ['apps/emdash-desktop/src/renderer/main.tsx', 'renderer 入口（挂球/浮窗/i18n）'],
    ['apps/emdash-desktop/src/main/host/xiangwo-orb', '项我球主进程服务（窗口/脚本/聊天目标）'],
    ['apps/emdash-desktop/src/main/host/xiangwo-cdp', '内嵌浏览器 CDP 桥（9223 对外 + 来源白名单）'],
    ['apps/emdash-desktop/src/main/host/xiangwo-browser', '内嵌浏览器代理 / 反向命令通道'],
    ['apps/emdash-desktop/src/main/host/browser/', '浏览器窗生命周期定制（注册/回收/配置文件）'],
    ['apps/emdash-desktop/src/main/host/window.ts', '主窗口 host 桥（taskSpace / expertHandoff / chatUrl）'],
    ['apps/emdash-desktop/src/main/host/updates/', '禁用自动更新（fork 不许被上游覆盖）'],
    ['apps/emdash-desktop/src/main/bootstrap/', '启动装配（注入 xiangwo 依赖 / 后台服务）'],
    ['apps/emdash-desktop/src/main/gateway/', 'gateway 定制（runtime broker / acp 入口）'],
    ['apps/emdash-desktop/src/entry/preload.ts', 'preload 桥（xiangwo 相关 API）'],
    ['apps/emdash-desktop/src/core/features/xiangwo/', '项我主对话 feature（8900 聊天）'],
    ['apps/emdash-desktop/src/core/features/handoff/', '专家交接台 feature'],
    ['apps/emdash-desktop/src/core/features/conversations/', '会话/ACP 定制（专家交接横条、专家表）'],
    ['apps/emdash-desktop/src/core/features/source-control/', '中文化（变更面板 / PR 区块 / diff 工具条）'],
    ['apps/emdash-desktop/src/core/features/tasks/', '中文化（任务界面）'],
    ['apps/emdash-desktop/src/core/features/workbench/', '中文化 + 项我入口（侧边栏/home）'],
    ['apps/emdash-desktop/src/core/features/settings/', '中文化 + 集成卡片（OpenViking/WeKnora）'],
    ['apps/emdash-desktop/src/core/features/skills/', '技能库定制（多来源/分类）'],
    ['apps/emdash-desktop/src/core/features/github/', 'octokit GitHub API 走 socks5 代理'],
    ['apps/emdash-desktop/src/core/features/agents/', '远程场景 bot 可用性（跳过 hostDependency）'],
    ['apps/emdash-desktop/src/core/features/projects/', '中文化 / 项目界面定制'],
    ['apps/emdash-desktop/src/core/features/workspaces/', 'workspace detail 定制（原生化）'],
    ['apps/emdash-desktop/src/core/primitives/desktop-host/', 'desktop-host 契约扩展（宿主新增 API）'],
    ['apps/emdash-desktop/src/core/primitives/telemetry/', '遥测默认关闭'],
    ['apps/emdash-desktop/src/core/manifests/browser/', '浏览器 manifest 注册（xiangwo/handoff 视图）'],
    ['apps/emdash-desktop/src/core/primitives/', 'core 基元定制'],
    ['apps/emdash-desktop/src/core/features/', 'core feature 定制'],
    ['apps/emdash-desktop/src/', 'renderer/main 侧定制'],
    ['apps/emdash-desktop/scripts/', '验收 harness / 打包脚本（xg 定制）'],
    ['apps/emdash-desktop/electron-builder.config.ts', '打包定制（fork owner / 去签名 / 依赖收集）'],
    ['apps/emdash-desktop/electron.vite.config.ts', '构建配置（别名 / 外置依赖）'],
    ['apps/emdash-desktop/tsconfig', 'TS 工程配置（别名/类型）'],
    ['apps/workspace-server/', 'workspace-server fork 运行时（无 Docker 本地编译补丁）'],
    ['packages/plugins/src/agents/impl/xiangwo', '项我 agent plugin（CLI 桥 8900）'],
    ['packages/plugins/src/agents/registry.ts', '插件注册表（挂 xiangwo 系 agent）'],
    ['packages/core/src/runtimes/workspace-registry/', 'lifecycle schema v3 兼容（future-version 根治）'],
    ['packages/core/src/runtimes/agent-config/', '中央技能库多来源接入'],
    ['packages/', 'packages 定制'],
  ],
};

// ---------- 基础工具 ----------

const C = process.stdout.isTTY && !process.argv.includes('--no-color')
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', z: '\x1b[0m' }
  : { r: '', y: '', g: '', d: '', b: '', z: '' };

function git(args) {
  // stdio 必须显式指定：否则 execFileSync 会把子进程 stderr 直接喷到终端
  //（gitHas() 用 cat-file 探测路径，必然产生 "exists on disk, but not in <rev>" 的噪音）
  return execFileSync('git', args, {
    cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function gitOk(args) {
  try { return git(args).trim(); } catch { return ''; }
}
function gitHas(rev, rel) {
  try { git(['cat-file', '-e', `${rev}:${rel}`]); return true; } catch { return false; }
}
function blobHash(buf) {
  return createHash('sha1').update(`blob ${buf.length}\0`, 'utf8').update(buf).digest('hex');
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, def) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const LIMIT = Number(val('--limit', 25)) || 25;

function ignored(rel) {
  return rel.startsWith(CFG.selfPrefix) || CFG.docRe.test(rel) || CFG.noiseRe.some((re) => re.test(rel));
}

// ---------- 锚点：标记「守着的那行代码」 ----------

/** 把「注释尾巴」从标记前的半行代码里剥掉；剥完为空说明标记独占一行 */
function codeBeforeMarker(line) {
  let code = line.slice(0, line.indexOf(MARKER));
  code = code.replace(/\{\/\*\s*$/, '').replace(/\/\*\s*$/, '').replace(/\/\/\s*$/, '')
    .replace(/<!--\s*$/, '').replace(/#\s*$/, '').replace(/^\s*\*+\s*$/, '');
  return norm(code);
}

/** 锚点候选必须像「代码」：不是注释碎片、不是纯标点、不是太短（`}` / `);` 这种不抗上游重构） */
function usableAnchor(s) {
  if (!s || s.length < 4) return false;
  if (/^(\/\/|\*|\/\*|#|<!--|-->)/.test(s)) return false;
  return /[A-Za-z0-9]/.test(s);
}

/** 像代码行吗？—— 用来在注释块里往下找「标记真正守着的那行代码」 */
function codeish(t) {
  if (!t || t.length < 4) return false;
  if (/^(\/\/|\/\*|\*|<!--|-->)/.test(t)) return false;              // 注释行
  if (/^#\s/.test(t)) return false;                                   // shell/python 注释
  if (/[。；、]/.test(t) && !/[;,{)}\]]\s*$/.test(t)) return false;    // 中文散文（注释块正文）
  if (/^(<[a-zA-Z/!]|import\b|export\b|const\b|let\b|var\b|function\b|class\b|return\b|if\b|for\b|while\b|await\b|async\b|type\b|interface\b|enum\b|describe\b|it\(|test\(|expect\b|[}\])]|[.#&@])/.test(t)) return true;
  if (/^[A-Za-z_$][\w$.[\]'"]*\s*[=(:]/.test(t)) return true;
  return /[;{]\s*$/.test(t);
}

/** 标记后面那句话（我们写的定制说明）—— 注释块里的标记用它当锚点 */
function descAfterMarker(line) {
  const rest = line.slice(line.indexOf(MARKER) + MARKER.length)
    .replace(/\*\/\s*$/, '').replace(/-->\s*$/, '').replace(/^\s*[:：—-]+\s*/, '').trim();
  return usableAnchor(rest) && /[\u4e00-\u9fff\w]/.test(rest) ? norm(rest).slice(0, 120) : null;
}

/** 窗口指纹：锚点本身在文件里不唯一（如 `return;`）时，带上「上一行非空行」凑成唯一指纹 */
const windowKey = (prev, f) => `${prev.slice(0, 80)} ⏎ ${f.slice(0, 110)}`;

/** 取锚点（去空白指纹，抗行号漂移）：
 *  ① 同一行标记左边的代码（inline 标记，最常见）
 *  ② 往下 15 行内第一行「像代码」的行（独占一行的标记注释 → 它守护的是下面的代码）
 *  ③ 都不行（标记在文件头注释块里）→ 用标记后面那句我们写的说明当指纹
 *  ②③ 拿到的指纹若在文件里不唯一 → 补上「上一行非空行」当窗口（否则判定会误命中别处）
 *  长度截断用 slice（不加省略号）：长行靠「前缀匹配」也能对上 */
function anchorFor(lines, i) {
  const counts = new Map();
  for (const l of lines) { const n = norm(l); if (n) counts.set(n, (counts.get(n) || 0) + 1); }
  const prevOf = (idx) => { for (let k = idx - 1; k >= 0; k -= 1) { const n = norm(lines[k]); if (n) return n; } return null; };
  const uniqOrWindow = (idx, fp) => {
    if ((counts.get(fp) || 0) <= 1) return fp.slice(0, 200);
    const prev = prevOf(idx);
    return prev ? windowKey(prev, fp) : fp.slice(0, 200);
  };

  const inline = codeBeforeMarker(lines[i]);
  if (usableAnchor(inline) && codeish(inline)) return inline.slice(0, 200);
  for (let j = i + 1; j < lines.length && j <= i + 15; j += 1) {
    const t = lines[j].trim();
    if (t.includes(MARKER) && t.length < 200) continue;               // 跳过密集的标记行
    if (codeish(t)) return uniqOrWindow(j, norm(t));
  }
  return descAfterMarker(lines[i]) || (usableAnchor(inline) ? inline.slice(0, 200) : null);
}

/** 一行的所有可比指纹：整行 / 标记左边的代码 / 标记后面的说明 */
function fingerprints(line) {
  const out = [norm(line)];
  if (line.includes(MARKER)) {
    const before = codeBeforeMarker(line);
    const after = descAfterMarker(line);
    if (before) out.push(before);
    if (after) out.push(after);
  }
  return out;
}

/** 锚点还在不在：整行精确匹配优先（`return;` 不能被上游的 `return void 0;` 蒙混过关）；
 *  窗口指纹用「上一行非空行 ⏎ 本行指纹」精确比对；
 *  只有在「锚点之后只剩注释」或「锚点被 200 字截断」时才允许前缀匹配 */
function anchorPresent(content, anchor) {
  const capped = anchor.length >= 200;
  let prev = null;
  for (const raw of content.split('\n')) {
    const n = norm(raw);
    for (const f of fingerprints(raw)) {
      if (f === anchor) return true;
      if (prev && windowKey(prev, f) === anchor) return true;
      if (capped && f.startsWith(anchor)) return true;
      if (f.startsWith(anchor)) {
        const rest = f.slice(anchor.length).trim();
        if (!rest || /^(\/\/|\/\*|\*|#|<!--|-->)/.test(rest)) return true;
      }
    }
    if (n) prev = n;
  }
  return false;
}

function analyzeFile(rel) {
  const buf = readFileSync(join(REPO, rel));
  const lines = buf.toString('utf8').split('\n');
  const markerLines = [];
  lines.forEach((l, i) => { if (l.includes(MARKER)) markerLines.push(i + 1); });
  const anchors = [];
  for (const ln of markerLines) {
    const a = anchorFor(lines, ln - 1);
    if (a && !anchors.includes(a)) anchors.push(a);
  }
  return { markers: markerLines.length, lines: markerLines, anchors, hash: blobHash(buf) };
}

// ---------- 提交溯源（批量：两次 git log，避免每文件 fork） ----------

function parseNameLog(text, keepFirst) {
  const map = new Map();
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('@@')) { cur = line.slice(2); continue; }
    if (!line || !cur) continue;
    if (keepFirst) { if (!map.has(line)) map.set(line, cur); } else { map.set(line, cur); }
  }
  return map;
}

function commitMaps(base) {
  const markerLog = gitOk(['log', '--reverse', '--format=@@%h|%ad|%s', '--date=short', '-S', MARKER, '--name-only', `${base}..HEAD`]);
  const touchLog = gitOk(['log', '--format=@@%h|%ad|%s', '--date=short', '--name-only', `${base}..HEAD`]);
  const first = parseNameLog(markerLog, true);
  const last = parseNameLog(touchLog, false);
  return {
    first(rel) {
      if (first.has(rel)) return first.get(rel);
      const r = gitOk(['log', '--reverse', '--format=%h|%ad|%s', '--date=short', `${base}..HEAD`, '--', rel]);
      return r.split('\n')[0] || gitOk(['log', '-1', '--format=%h|%ad|%s', '--date=short', '--', rel]);
    },
    last(rel) {
      if (last.has(rel)) return last.get(rel);
      return gitOk(['log', '-1', '--format=%h|%ad|%s', '--date=short', '--', rel]);
    },
  };
}

// ---------- 一句话说明：人工前缀表 > commit message 自动提炼 ----------

function cleanSubject(s) {
  const t = s.replace(/\[XG-CUSTOM\]/g, '')
    .replace(/^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|merge|bump)\s*(\([^)]*\))?:\s*/i, '')
    .trim();
  return cut(t || s, 70);
}
function noteFor(rel, firstSubject) {
  let best = null;
  for (const [prefix, note] of CFG.noteOverrides) {
    if (rel.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, note];
  }
  return best ? best[1] : cleanSubject(firstSubject || '(未知)');
}

// ---------- 基点 / 上游 ----------

const UPSTREAM = val('--upstream', 'origin/main');
function resolveBase() {
  const explicit = val('--base', null);
  if (explicit) return explicit;
  const mb = gitOk(['merge-base', 'HEAD', UPSTREAM]);
  if (!mb) {
    console.error(`${C.r}✗ 算不出 merge-base（HEAD vs ${UPSTREAM}）：先 git fetch ${UPSTREAM.split('/')[0]} 再跑${C.z}`);
    process.exit(2);
  }
  return mb;
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return null;
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return null; }
}

// ================= --gen =================

function doGen(base) {
  const files = gitOk(['grep', '-l', '--fixed-strings', MARKER]).split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => !ignored(f));
  if (!files.length) { console.error(`${C.r}✗ 一个带标记的文件都没扫到（跑错目录了？）${C.z}`); process.exit(2); }
  const maps = commitMaps(base);
  const out = {};
  let markerTotal = 0;
  let nNew = 0;
  for (const rel of files.sort()) {
    const info = analyzeFile(rel);
    const first = maps.first(rel);
    const last = maps.last(rel);
    const isNew = !gitHas(base, rel);
    if (isNew) nNew += 1;
    markerTotal += info.markers;
    out[rel] = {
      markers: info.markers,
      lines: info.lines,
      anchors: info.anchors,
      hash: info.hash,
      origin: isNew ? 'new' : 'modified',
      firstCommit: first,
      lastCommit: last,
      note: noteFor(rel, (first.split('|')[2] || '')),
    };
  }
  const manifest = {
    schema: 1,
    tool: 'scripts/xg-custom/check.mjs --gen',
    hint: '标记是锚点，hash 只作辅助：上游 rebase 后 hash/行号必变，判「定制还在不在」看 markers 与 anchors',
    upstream: { ref: UPSTREAM, base },
    stats: { files: files.length, markers: markerTotal, newFiles: nNew, modifiedFiles: files.length - nNew },
    files: out,
  };
  const prev = loadManifest();
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`${C.b}[xg-custom] --gen${C.z} 基点=${base.slice(0, 9)} 上游=${UPSTREAM}`);
  console.log(`  台账：${files.length} 个文件 / ${markerTotal} 处标记（新增文件 ${nNew}，改动上游文件 ${files.length - nNew}）`);
  if (prev && prev.files) {
    const before = new Set(Object.keys(prev.files));
    const after = new Set(Object.keys(out));
    const added = [...after].filter((f) => !before.has(f));
    const removed = [...before].filter((f) => !after.has(f));
    const delta = [...after].filter((f) => before.has(f) && prev.files[f].markers !== out[f].markers);
    if (added.length) console.log(`  ${C.g}+ 新增入账 ${added.length}${C.z}: ${added.slice(0, 5).join(', ')}${added.length > 5 ? ' …' : ''}`);
    if (removed.length) console.log(`  ${C.y}- 移除出账 ${removed.length}${C.z}: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ' …' : ''}`);
    if (delta.length) console.log(`  ${C.y}~ 标记数变化 ${delta.length}${C.z}: ${delta.slice(0, 5).map((f) => `${f} ${prev.files[f].markers}→${out[f].markers}`).join(', ')}${delta.length > 5 ? ' …' : ''}`);
    if (!added.length && !removed.length && !delta.length) console.log(`  ${C.g}= 文件集合与标记数未变（重复 --gen 幂等）${C.z}`);
  }
  console.log(`  写入 ${MANIFEST.replace(REPO + '/', '')}`);
  return 0;
}

// ================= --list =================

function doList() {
  const m = loadManifest();
  if (!m) { console.error(`${C.r}✗ 没有台账：先跑 check.mjs --gen${C.z}`); process.exit(2); }
  console.log(`${C.b}[xg-custom] 定制台账${C.z} ${m.stats.files} 文件 / ${m.stats.markers} 处标记 （基点 ${String(m.upstream.base).slice(0, 9)}）`);
  for (const [rel, f] of Object.entries(m.files)) {
    let now = 0;
    try { now = analyzeFile(rel).markers; } catch { now = -1; }
    const flag = now < 0 ? `${C.r}文件不存在${C.z}` : now === f.markers ? `${C.g}${now}✓${C.z}` : `${C.y}${now}≠${f.markers}${C.z}`;
    console.log(`\n${C.b}${rel}${C.z}  ${f.markers} 处 [${f.origin === 'new' ? '新增' : '改动上游'}] 现:${flag}`);
    console.log(`  ${f.note}`);
    console.log(`  ${C.d}行 ${f.lines.join(', ')}${C.z}`);
    console.log(`  ${C.d}首 ${f.firstCommit || '?'}  |  近 ${f.lastCommit || '?'}  |  blob ${f.hash.slice(0, 9)}${C.z}`);
  }
  return 0;
}

// ================= --check =================

function parseAddedHunks(patch) {
  const map = new Map();
  let file = null;
  let hunk = null;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++ b/')) { file = raw.slice(6); hunk = null; continue; }
    if (raw.startsWith('+++ /dev/null')) { file = null; continue; }
    if (!file) continue;
    if (raw.startsWith('@@')) {
      hunk = { header: raw, head: raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/), added: [] };
      if (!map.has(file)) map.set(file, []);
      map.get(file).push(hunk);
      continue;
    }
    if (hunk && raw.startsWith('+') && !raw.startsWith('+++')) hunk.added.push(raw.slice(1));
  }
  return map;
}

/** 台账清点：拿台账对工作区，回答「哪些定制点丢了」（--check 与 --after-merge 共用） */
function ledgerAudit(m) {
  const lost = [];
  const drifted = [];
  const intact = [];
  for (const [rel, f] of Object.entries(m.files)) {
    const abs = join(REPO, rel);
    if (!existsSync(abs)) { lost.push({ rel, f, kind: '文件没了', detail: '整个文件在工作区不存在（上游删了？改名了？）' }); continue; }
    const buf = readFileSync(abs);
    const content = buf.toString('utf8');
    const nowMarkers = content.split('\n').filter((l) => l.includes(MARKER)).length;
    const missAnchors = f.anchors.filter((a) => !anchorPresent(content, a));
    if (nowMarkers === 0) { lost.push({ rel, f, kind: '标记全没了', detail: `台账记 ${f.markers} 处，现在 0 处` }); continue; }
    if (nowMarkers < f.markers) { lost.push({ rel, f, kind: `标记少了 ${f.markers - nowMarkers} 处`, detail: `台账 ${f.markers} → 现在 ${nowMarkers}` }); continue; }
    if (missAnchors.length) { lost.push({ rel, f, kind: `定制点疑似丢 ${missAnchors.length} 处`, detail: `标记在（${nowMarkers} 处）但锚点对不上：${missAnchors.map((a) => cut(a, 60)).join(' | ')}` }); continue; }
    if (blobHash(buf) !== f.hash) drifted.push({ rel, f, nowMarkers });
    else intact.push(rel);
  }
  return { lost, drifted, intact };
}

/** 打印「丢了什么 + 从哪个提交捞回来」（--check / --after-merge 共用） */
function printLost(lost, limit = LIMIT) {
  for (const l of lost.slice(0, limit)) {
    const first = (l.f.firstCommit || '').split('|')[0];
    const where = l.f.lines && l.f.lines.length ? `${l.rel}:${l.f.lines.join(',')}` : l.rel;
    console.log(`\n  ${C.r}${l.kind}${C.z}  ${where}`);
    console.log(`    ${C.d}${l.detail}${C.z}`);
    console.log(`    ${C.d}台账：${l.f.markers} 处 / ${l.f.anchors.length} 锚点；首次引入 ${l.f.firstCommit || '?'}${C.z}`);
    console.log(`    捞回：git log --all -S'${MARKER}' --format='%h %ad %s' --date=short -- ${l.rel}`);
    if (first) console.log(`          git show ${first} -- ${l.rel}     ${C.d}# 看当时怎么改的，手工重贴（别直接 checkout，会覆盖上游新代码）${C.z}`);
    if (/i18n|locales|\.tsx$/.test(l.rel)) console.log(`          node scripts/xg-i18n/apply.mjs --check     ${C.d}# 中文化有行级对照表，能自动还原${C.z}`);
  }
  if (lost.length > limit) console.log(`\n  ${C.d}…还有 ${lost.length - limit} 个（--limit 调整）${C.z}`);
}

/** 上游某个文件的最近一次提交（给「上游同改」可行动信息） */
function lastCommitOn(ref, rel) {
  return gitOk(['log', '-1', '--format=%h %ad %s', '--date=short', ref, '--', rel]);
}

function doCheck(base) {
  const m = loadManifest();
  if (!m) { console.error(`${C.r}✗ 没有台账：先跑 check.mjs --gen${C.z}`); process.exit(2); }
  const markedNow = new Set(gitOk(['grep', '-l', '--fixed-strings', MARKER]).split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => !ignored(f)));

  const patch = gitOk([
    'diff', '-U0', '--no-renames', base, 'HEAD', '--', '.',
    ':(exclude).github/electron-builder-cache', ':(exclude).github/electron-builder-bin',
  ]);
  const added = parseAddedHunks(patch);
  const changedFiles = [...added.keys()].filter((f) => !ignored(f));
  const allChanged = gitOk([
    'diff', '--name-only', '--no-renames', base, 'HEAD', '--', '.',
    ':(exclude).github/electron-builder-cache', ':(exclude).github/electron-builder-bin',
  ]).split('\n').map((s) => s.trim()).filter(Boolean).length;

  const gaps = [];       // 🔴 真·漏标：已入账的定制文件里，带定制特征的无标记 hunk（= 新回归，计入退出码）
  const untracked = [];  // 🟠 未入账文件：整个文件没标记但改动含定制特征（= 历史欠账，--strict 才计入）
  const review = [];     // 🟡 待确认：定制文件里的无标记 hunk（可能是上游内容/合并带入）
  const info = [];       // 非定制文件改动（版本号/文档/上游适配）
  const stale = [];      // 台账过期
  // 命中「定制特征」的行（跳过版本号之类的噪音行）
  const evHit = (lines) => lines.some((l) => l.trim() && !CFG.trivialRe.some((re) => re.test(l)) && CFG.evidence.some((re) => re.test(l)));

  for (const rel of changedFiles) {
    const inLedger = Boolean(m.files[rel]);
    if (!inLedger && !markedNow.has(rel)) {
      // 从来不是定制文件：默认当上游适配/版本号/文档噪音，除非 diff 里出现定制特征
      const hits = added.get(rel).filter((h) => evHit(h.added));
      if (hits.length) untracked.push({ rel, hunks: hits });
      else info.push(rel);
      continue;
    }
    for (const h of added.get(rel)) {
      if (h.added.some((l) => l.includes(MARKER))) continue;
      const at = h.head ? `${rel}:${h.head[1]}` : rel;
      const sample = cut(norm(h.added.find((l) => l.trim()) || '(空行)'), 90);
      if (evHit(h.added)) gaps.push({ rel, at, sample });
      else review.push({ rel, at, sample });
    }
  }

  // 台账过期：标记集合 vs 台账集合
  for (const rel of markedNow) if (!m.files[rel]) stale.push(`有标记但不在台账：${rel} → 跑 --gen`);
  for (const rel of Object.keys(m.files)) if (!markedNow.has(rel)) stale.push(`台账里有但文件已无标记：${rel} → 定制标记可能被上游覆盖，跑 --after-merge`);

  // 上游风险（origin/main 相对基点）
  const risk = { deleted: [], added: [], touched: [], safe: [] };
  for (const rel of Object.keys(m.files)) {
    const upNow = gitHas(UPSTREAM, rel);
    const atBase = gitHas(base, rel);
    const upChanged = gitHas(base, rel) && gitOk(['diff', '--name-only', base, UPSTREAM, '--', rel]) !== '';
    if (atBase && !upNow) risk.deleted.push(rel);
    else if (!atBase && upNow) risk.added.push(rel);
    else if (upChanged) risk.touched.push(rel);
    else risk.safe.push(rel);
  }

  // 台账清点（定制点丢了没有）
  const audit = ledgerAudit(m);

  // ---- 输出：按「升级上游那一刻最关心的三个问题」排序 ----
  console.log(`${C.b}[xg-custom] --check${C.z} 上游=${UPSTREAM} 基点=${base.slice(0, 9)} 台账=${m.stats.files} 文件 / ${m.stats.markers} 处标记`);
  console.log(`  改动文件 ${allChanged} 个（相对基点，不含打包缓存；其中 ${changedFiles.length} 个有文本增删，差值=纯删除/二进制/重命名）：带标记 ${changedFiles.filter((f) => markedNow.has(f)).length} 个 / 无标记 ${changedFiles.filter((f) => !markedNow.has(f)).length} 个\n`);

  // ① 上游动了我们哪些定制文件
  console.log(`${C.b}一、上游这次动了我们哪些定制文件${C.z} ${C.d}（先看这里：改同一个文件 = 合并冲突/覆盖高危）${C.z}`);
  const riskLine = (icon, color, label, arr) => console.log(`  ${color}${icon} ${label} ${arr.length}${C.z}`);
  riskLine('🔴', C.r, '上游删除了我们定制的文件（定制要改挂载点）', risk.deleted);
  riskLine('🟠', C.y, '上游新增了同名文件（合并会撞车）', risk.added);
  riskLine('🟡', C.y, '上游也改了这些文件（合并时需重贴标记）', risk.touched);
  riskLine('🟢', C.g, '上游未动（定制安全）', risk.safe);
  for (const rel of [...risk.deleted, ...risk.added, ...risk.touched].slice(0, LIMIT)) {
    console.log(`    ${rel}`);
    console.log(`      ${C.d}上游最近：${lastCommitOn(UPSTREAM, rel) || '(上游没有这个文件)'}${C.z}`);
    console.log(`      ${C.d}我们最近：${m.files[rel].lastCommit || '?'}${C.z}`);
  }
  if (risk.deleted.length + risk.added.length + risk.touched.length > LIMIT) console.log(`    ${C.d}…还有若干（--limit 调整）${C.z}`);
  if (!risk.deleted.length && !risk.added.length && !risk.touched.length) console.log(`  ${C.g}⇒ 上游这一版没碰我们定制的任何文件（合并风险仅剩新增目录/删除目录）${C.z}`);

  // ② 我们的定制点丢了 / 没标
  console.log(`\n${C.b}二、我们的定制点：丢了没有 / 有没有漏标${C.z}`);
  console.log(`  ${C.b}2.1 丢失${C.z}（拿台账的标记数 + 锚点指纹对工作区）`);
  if (!audit.lost.length) console.log(`    ${C.g}✅ 0 处丢失（完好 ${audit.intact.length} / 仅上下文漂移 ${audit.drifted.length}）${C.z}`);
  else {
    console.log(`    ${C.r}🔴 ${audit.lost.length} 个文件有丢失 —— 计入退出码${C.z}`);
    printLost(audit.lost);
  }
  console.log(`\n  ${C.b}2.2 漏标${C.z}（改了定制代码却没打 [XG-CUSTOM]）`);
  if (!gaps.length) console.log(`    ${C.g}✅ 已入账的定制文件里 0 处新漏标${C.z}`);
  else {
    console.log(`    ${C.r}🔴 ${gaps.length} 处 —— 计入退出码（改一行标一行，然后 --gen）${C.z}`);
    for (const g of gaps.slice(0, LIMIT)) console.log(`      ${g.at}\n        ${C.d}+ ${g.sample}${C.z}`);
    if (gaps.length > LIMIT) console.log(`      ${C.d}…还有 ${gaps.length - LIMIT} 处（--limit 调整）${C.z}`);
  }
  if (untracked.length) {
    console.log(`    ${C.y}🟠 ${untracked.length} 个未入账文件（整个文件没标记，但改动含定制特征）—— 历史欠账，--strict 才计入退出码${C.z}`);
    console.log(`      ${C.d}它们的定制目前只靠 git 历史 + scripts/xg-i18n/manifest.json 兜着；补标记后 --gen 收进台账${C.z}`);
    for (const u of untracked.slice(0, 10)) {
      const at = u.hunks[0] && u.hunks[0].head ? `${u.rel}:${u.hunks[0].head[1]}` : u.rel;
      console.log(`      ${C.d}${at}${C.z}`);
    }
    if (untracked.length > 10) console.log(`      ${C.d}…还有 ${untracked.length - 10} 个${C.z}`);
    console.log(`      ${C.d}定位引入提交：git log --format='%h %ad %s' --date=short -- <上面某个文件>${C.z}`);
  }
  if (review.length) {
    console.log(`    ${C.y}🟡 ${review.length} 处待确认：定制文件里的无标记 hunk（多为上游内容/合并带入，扫一眼别是漏标）${C.z}`);
    for (const r of review.slice(0, 8)) console.log(`      ${C.d}${r.at}  + ${r.sample}${C.z}`);
    if (review.length > 8) console.log(`      ${C.d}…还有 ${review.length - 8} 处${C.z}`);
  }
  console.log(`\n  ${C.b}2.3 台账时效${C.z}`);
  if (!stale.length) console.log(`    ${C.g}✅ 台账与工作区一致${C.z}`);
  else { console.log(`    ${C.y}⚠️ ${stale.length} 条（跑 --gen 刷新）${C.z}`); for (const s of stale.slice(0, LIMIT)) console.log(`      ${s}`); }
  if (info.length) {
    console.log(`\n  ${C.d}（另：非定制文件改动 ${info.length} 个 —— 版本号/文档/上游适配，无需处理）${C.z}`);
  }

  // ③ 下一步
  const strict = has('--strict');
  const fatal = audit.lost.length + gaps.length + stale.length + risk.deleted.length + risk.added.length + (strict ? untracked.length : 0);
  console.log(`\n${C.b}三、下一步（直接复制粘贴）${C.z}`);
  const step = (n, cmd, why) => console.log(`  ${C.b}${n}${C.z} ${cmd}\n     ${C.d}${why}${C.z}`);
  if (audit.lost.length) {
    step('①', '按上面 2.1 每条的「捞回」两条命令逐个处理（git log -S → git show → 手工重贴 + 补 [XG-CUSTOM]）', `${audit.lost.length} 个文件的定制点丢了，先捞回来再谈别的`);
    step('②', 'node scripts/xg-custom/check.mjs --gen', '重贴完刷新台账');
    step('③', 'node scripts/xg-custom/check.mjs --check', '复查：2.1 应回到 ✅');
  } else if (gaps.length) {
    step('①', '给上面 2.2 的 🔴 处补 [XG-CUSTOM] 标记', `${gaps.length} 处漏标（改一行标一行）`);
    step('②', 'node scripts/xg-custom/check.mjs --gen', '把新标记收进台账');
    step('③', 'node scripts/xg-custom/check.mjs --check', '复查：2.2 应回到 ✅');
  } else if (stale.length || audit.drifted.length) {
    step('①', 'node scripts/xg-custom/check.mjs --gen', `台账与工作区有差异（差异 ${stale.length} 条 / 漂移 ${audit.drifted.length} 个文件）`);
  } else {
    step('①', '无需动作（定制点全在、无漏标、台账最新）', '要留痕就接着跑下面第 ② 条');
  }
  const commit = 'git add scripts/xg-custom/manifest.json && git commit -m "chore(xg-custom): 刷新定制台账"';
  step(audit.lost.length || gaps.length || stale.length ? '④' : '②', commit, '台账跟代码一起提交（台账和代码分开提交 → 下次审计基准是错的）');
  if (!strict && untracked.length) console.log(`  ${C.d}（另：${untracked.length} 个历史欠账未入账，默认不拦；想一起拦加 --strict）${C.z}`);

  console.log(`\n${fatal ? C.r + '✗ 有需要处理的项' : C.g + '✅ 通过'}${C.z}（丢失 ${audit.lost.length} / 漂移 ${audit.drifted.length} / 漏标 ${gaps.length} / 未入账 ${untracked.length} / 待确认 ${review.length} / 台账差异 ${stale.length} / 上游删除 ${risk.deleted.length} / 上游撞车 ${risk.added.length} / 上游同改 ${risk.touched.length}）`);
  return fatal ? 1 : 0;
}

// ================= --after-merge =================

function doAfterMerge(base) {
  const m = loadManifest();
  if (!m) { console.error(`${C.r}✗ 没有台账：先跑 check.mjs --gen${C.z}`); process.exit(2); }
  const { lost, drifted, intact } = ledgerAudit(m);
  const audit = { lost, drifted, intact };

  console.log(`${C.b}[xg-custom] --after-merge${C.z} 基点=${base.slice(0, 9)} 台账=${m.stats.files} 文件 / ${m.stats.markers} 处标记\n`);
  console.log(`${C.b}定制点清点${C.z}`);
  console.log(`  ${C.g}✅ 一字未动 ${intact.length}${C.z}`);
  console.log(`  ${C.y}🟡 上游改了周边代码（定制点都在，台账需刷新）${drifted.length}${C.z}`);
  console.log(`  ${C.r}🔴 疑似丢失 ${lost.length}${C.z}`);

  if (drifted.length) {
    console.log(`\n${C.b}🟡 上下文漂移（定制在，只是周边变了 → 跑 --gen 刷新台账）${C.z}`);
    for (const d of drifted.slice(0, LIMIT)) console.log(`    ${d.rel}  ${d.f.markers} 处`);
    if (drifted.length > LIMIT) console.log(`    ${C.d}…还有 ${drifted.length - LIMIT} 个${C.z}`);
  }

  if (lost.length) {
    console.log(`\n${C.b}${C.r}🔴 丢失明细 + 从哪捞回来${C.z}`);
    printLost(lost);
  }

  const fatal = audit.lost.length;
  console.log(`\n${fatal ? C.r + '✗ 有定制点丢失' : C.g + '✅ 定制点都在'}${C.z}（丢失 ${lost.length} / 漂移 ${drifted.length} / 完好 ${intact.length}）`);
  if (!fatal && drifted.length) console.log(`  下一步：确认无误后跑 node scripts/xg-custom/check.mjs --gen 刷新台账`);
  return fatal ? 1 : 0;
}

// ================= main =================

const MODE = has('--gen') ? 'gen' : has('--after-merge') ? 'after-merge' : has('--list') ? 'list' : has('--check') ? 'check' : null;
if (!MODE) {
  console.log(`用法：node scripts/xg-custom/check.mjs <--gen|--check|--list|--after-merge> [--base <sha>] [--upstream <ref>] [--strict]`);
  console.log(`  --gen          重新生成台账 manifest.json（幂等）`);
  console.log(`  --check        与上游比对：漏标告警 + 台账时效 + 上游风险（--strict 连历史欠账一起拦）`);
  console.log(`  --list         打印台账（文件 / 行号 / 说明 / 当前实际标记数）`);
  console.log(`  --after-merge  上游合并/rebase 后：报告哪些定制点丢了 + 从哪个提交能捞回来`);
  process.exit(2);
}
const BASE = MODE === 'list' ? null : resolveBase();
const code = MODE === 'gen' ? doGen(BASE) : MODE === 'list' ? doList() : MODE === 'check' ? doCheck(BASE) : doAfterMerge(BASE);
process.exit(code);
