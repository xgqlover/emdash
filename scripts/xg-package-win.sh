#!/bin/bash
# [XG-CUSTOM 2026-10-09] —— **本机打 Windows exe**（NSIS 单文件）的入口，照 `xg-package-linux.sh` 的纪律。
#
# 为什么需要它：以前 exe 只能走 GitHub Actions（`windows-2022` runner）——
#   2026-10-09 账号 Actions 因计量额度用满被停（`gh workflow run` 恒 422），而本机**已经有 wine**
#   （`/opt/deepin-wine8-stable/bin/wine` = wine-8.16，以前 MEMORY 记的"缺 wine"已不成立）
#   ⇒ 本机也能打 NSIS 单文件 exe。**不上传源码、不等 CI、不花钱。**
#
# 🔴 两条铁律（与 Linux 版同源，别省）：
#   ① **必须显式带 pnpm UA** —— 否则 electron-builder 走 npm 收集器 ⇒ 静默缺包
#      （顶层 node_modules 561→168、`@emdash/core` 2892→0、原生 .node 全没）。见 Linux 版文件头。
#   ② **`--config electron-builder.config.ts` 不能省** —— 省了会拿包名 `@emdash/emdash-desktop`
#      当 executableName ⇒ 产物名变成 `@...exe`。
#
# 用法: bash scripts/xg-package-win.sh
#       XG_ALLOW_DIRTY=1 bash scripts/xg-package-win.sh     # 明知有 WIP 也打（会编进包）
#       XG_WINE_BIN=/usr/bin bash scripts/xg-package-win.sh # 换 wine 位置
# 退出码: 0 = 打出并通过校验；非 0 = 没打成/校验没过（**不会**动 release/ 里在用的东西）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
APP=apps/emdash-desktop
APP_ABS="$(pwd)/$APP"
OUT="$APP_ABS/release-new"
EXE="$OUT/emdash-x64.exe"
EXPECT_TOP=${XG_EXPECT_TOP_MODULES:-500}          # asar 顶层 node_modules 下限（正常 561）

export ELECTRON_MIRROR=${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}
export ELECTRON_BUILDER_BINARIES_MIRROR=${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}
WINE_BIN=${XG_WINE_BIN:-/opt/deepin-wine8-stable/bin}
export PATH="$WINE_BIN:$PATH"

echo "=== ① 前置：wine 必须在 PATH（nsis 单文件靠它设 exe 资源）==="
command -v wine >/dev/null || { echo "❌ PATH 里没有 wine（用 XG_WINE_BIN=... 指一个）"; exit 1; }
echo "   wine: $(wine --version 2>/dev/null)"
echo "   electron: $(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo '?')"
echo "   镜像: $ELECTRON_MIRROR"

echo "=== ② 树干净检查（未提交改动会被编进包）==="
if [ "${XG_ALLOW_DIRTY:-}" = "1" ]; then
  bash scripts/xg-pre-package.sh --force || true
else
  bash scripts/xg-pre-package.sh || { echo "❌ 树不干净；确认要带 WIP 打就加 XG_ALLOW_DIRTY=1"; exit 1; }
fi

echo "=== ③ 编译（先清 out/，防带内容哈希的旧 chunk 混进包）==="
rm -rf "$APP/out"
(cd "$APP" && pnpm run build) || { echo "❌ 编译失败"; exit 1; }

echo "=== ④ 打包（--win nsis，显式带 pnpm UA）==="
UA="pnpm/10.28.2 npm/? node/$(node -v) linux x86_64"
(cd "$APP" && rm -rf release-new && npm_config_user_agent="$UA" \
  ../../node_modules/.bin/electron-builder --win nsis --publish never \
  --config electron-builder.config.ts -c.directories.output=release-new) || { echo "❌ 打包失败"; exit 1; }
ls -l "$OUT" 2>/dev/null | sed 's/^/   /'
[ -f "$EXE" ] || { echo "❌ 没找到产物 $EXE"; exit 1; }

echo "=== ⑤ 校验 asar：防「静默缺包」（顶层包数 / @emdash/core / 原生 .node）==="
ASAR="$OUT/win-unpacked/resources/app.asar"
[ -f "$ASAR" ] || { echo "❌ 没找到 $ASAR（win-unpacked 没生成？）"; exit 1; }
STATS=$(node - "$ASAR" <<'EOF'
const a = require('@electron/asar');
const l = a.listPackage(process.argv[2]);
const top = new Set(l.map((x) => {
  const m = x.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)(\/|$)/);
  return m ? m[1] : null;
}).filter(Boolean));
const core = l.filter((x) => /\/node_modules\/@emdash\/core\//.test(x)).length;
const native = l.filter((x) => /\.node$/.test(x)).length;
console.log(JSON.stringify({ top: top.size, core, native, total: l.length }));
EOF
)
echo "   $STATS"
TOP=$(printf '%s' "$STATS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).top))')
CORE=$(printf '%s' "$STATS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).core))')
if [ "${TOP:-0}" -lt "$EXPECT_TOP" ] || [ "${CORE:-0}" -eq 0 ]; then
  echo "❌ 校验不过：顶层包 $TOP（应 ≥$EXPECT_TOP）/ @emdash/core 条目 $CORE（应 >0）"
  echo "   ⇒ 这是「按 npm 收集」的缺包形态。排查：确认用了本脚本（UA 带 pnpm）。"
  exit 1
fi
echo "   ✅ 顶层包 $TOP ≥ $EXPECT_TOP，且 @emdash/core 在包里"

echo "=== ⑥ 交付路径 + 指纹 ==="
ls -l --time-style=+%m-%d\ %H:%M "$EXE" | sed 's/^/   /'
file -b "$EXE" | cut -c1-90 | sed 's/^/   file: /'
sha256sum "$EXE" | sed 's/^/   sha256: /'
echo "=== ✅ 完成：$EXE （拷到 Windows 覆盖安装即可）==="
