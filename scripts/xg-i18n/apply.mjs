#!/usr/bin/env node
// [XG-CUSTOM] emdash 中文化「还原器」
// 用途：emdash 上游更新后，把我们改过的中文化还原回去（上游改动会覆盖掉 t() 调用）
//
//   node scripts/xg-i18n/apply.mjs --check    # 只体检，报告哪些对照丢了（CI 可用，有丢失则退出码 1）
//   node scripts/xg-i18n/apply.mjs --apply    # 还原：逐条把「上游原文行」替换成「我们的中文行」
//
// 对照表：scripts/xg-i18n/manifest.json（从提交里抽出的行级对照，越攒越多）
// 语言包：apps/emdash-desktop/src/renderer/lib/i18n/locales.ts（zh/en 双包，key 必须两边都有）
//
// 注意：
// 1) 只做「整行」替换 —— 行匹配不到就报 MISSING，绝不模糊替换（防止误伤上游新代码）
// 2) 文件里若没有 i18n import，脚本会自己补上（插在最后一个以 ; 结尾的 import 之后，
//    不能插在「最后一个 import 开头的行」后面，多行 import 会被劈开）
// 3) locales.ts 是新文件（上游没有），一般不会被覆盖；被覆盖时从 git 历史 checkout 回来：
//      git checkout 217a41909 -- apps/emdash-desktop/src/renderer/lib/i18n/locales.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const MANIFEST = join(HERE, 'manifest.json');
const IMPORT_MARK = "from '@renderer/lib/i18n'";
const IMPORT_LINE = "import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]";

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** 补 import：插在最后一个「以 import 开头且以 ; 结尾」的行之后 */
function ensureImport(lines) {
  if (lines.some((l) => l.includes(IMPORT_MARK))) return false;
  const cand = lines.map((l, i) => (l.startsWith('import ') && l.trimEnd().endsWith(';') ? i : -1)).filter((i) => i >= 0);
  lines.splice(cand.length ? Math.max(...cand) + 1 : 0, 0, IMPORT_LINE);
  return true;
}

let applied = 0;
let already = 0;
const missing = [];
const touched = [];

for (const [rel, pairs] of Object.entries(manifest.files)) {
  const abs = join(REPO, rel);
  if (!existsSync(abs)) {
    missing.push(`${rel}  ← 整个文件不存在（上游改名/删除？）`);
    continue;
  }
  const lines = readFileSync(abs, 'utf8').split('\n');
  let changed = false;
  for (const [from, to] of pairs) {
    if (lines.includes(to)) {
      already += 1;
    } else if (lines.includes(from)) {
      if (mode === 'apply') {
        lines[lines.indexOf(from)] = to;
        changed = true;
      }
      applied += 1;
    } else {
      missing.push(`${rel}  ← 找不到原文: ${from.trim().slice(0, 80)}`);
    }
  }
  if (changed) {
    ensureImport(lines);
    writeFileSync(abs, lines.join('\n'), 'utf8');
    touched.push(rel);
  }
}

const total = already + applied + missing.length;
console.log(`[xg-i18n] 模式=${mode}  对照总数=${total}`);
console.log(`  已译好(命中中文行) ${already}`);
console.log(`  待还原(命中原文行) ${applied}${mode === 'apply' ? ` → 已写入 ${touched.length} 个文件` : '（--apply 才会写）'}`);
if (missing.length) {
  console.log(`  ⚠️ 丢失/漂移 ${missing.length} 条：`);
  for (const m of missing.slice(0, 40)) console.log('    ' + m);
  if (missing.length > 40) console.log(`    …还有 ${missing.length - 40} 条`);
}
if (mode === 'check' && missing.length) process.exit(1);
if (mode === 'check' && applied) {
  console.log('  提示：上面「待还原」不为 0 = 有中文行被上游覆盖了，跑 --apply 还原');
  process.exit(1);
}
