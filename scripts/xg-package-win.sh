#!/bin/bash
# [XG-CUSTOM 2026-10-09] —— **本机打 Windows exe**（NSIS 单文件）的入口，照 `xg-package-linux.sh` 的纪律。
#
# 为什么需要它：以前 exe 只能走 GitHub Actions（`windows-2022` runner）——
#   2026-10-09 账号 Actions 因计量额度用满被停（`gh workflow run` 恒 422），而本机**已经有 wine**
#   （`/opt/deepin-wine8-stable/bin/wine` = wine-8.16，以前 MEMORY 记的"缺 wine"已不成立）
#   ⇒ 本机也能打 NSIS 单文件 exe。**不上传源码、不等 CI、不花钱。**
#
# 🔴 两条铁律（与 Linux 版同源，别省）：
#   ① **依赖收集器必须是 pnpm** —— 否则走 npm 收集器 ⇒ 静默缺包。判定顺序：
#      `package.json#packageManager` → 目录 lockfile → 环境变量 UA → 兜底 npm。本脚本显式带 pnpm UA，
#      并且 app 的 package.json 现已声明 `"packageManager": "pnpm@10.28.2"`（双保险）。
#      ⚠️ 别再拿"顶层包 ≥500 / @emdash/core 在包里"当判据 —— **CI 正品同样是 0**（那是 electron-vite 打进 out/ 的）。
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

echo "=== ①b 平台可选依赖必须是 win32 版（本机打 win 特有的坑）==="
# [XG-CUSTOM 2026-10-09] 在 Linux 上 `pnpm install` 装出来的是 **linux 版**可选依赖
#   （`@parcel/watcher-linux-x64-glibc` / `@typescript/native-preview-linux-x64`），而 CI 在 Windows runner
#   上装的是 win32 版 ⇒ 打出来的包会缺 win 侧实现（文件监听/TS 原生预览退化）。
#   修法（在**构建用的克隆**里做，别改共用工作区）：
#     pnpm-workspace.yaml 加：
#       supportedArchitectures:
#         os: [win32]
#         cpu: [x64]
#     然后 `pnpm install --no-frozen-lockfile`
MISS_PLAT=0
for m in "@parcel/watcher-win32-x64" "@typescript/native-preview-win32-x64"; do
  [ -e "node_modules/$m" ] || { MISS_PLAT=1; echo "   ❌ 缺 win32 可选依赖：node_modules/$m"; }
done
if [ "$MISS_PLAT" = "1" ]; then
  echo "   ⇒ 先按上面注释里的两步装 win32 可选依赖，再重跑本脚本（否则打出来的包与 CI 正品包构成不一致）。"
  exit 1
fi
echo "   ✅ win32 可选依赖在位"

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

echo "=== ⑤ 校验：★ 正确判据（旧的「顶层包 ≥500」已过期，见 emdash-Windows-exe-本机打包-2026-10-09.md §三）==="
# 为什么旧判据错：本仓 electron-builder 配置有一条 [XG-CUSTOM] 显式收集清单，**只收 emdash-desktop 的直接依赖**；
#   workspace 包（@emdash/core 等）是 electron-vite 打进 `out/` 的 ⇒ 本来就不在 node_modules 里。
#   CI 正品实测同样是「顶层包 0 个 @emdash/core」。
# 正确判据 = ① app 的每个 dependencies 都在包里 ② out/ 的 main/preload/renderer 都在。
ASAR="$OUT/win-unpacked/resources/app.asar"
UNPACKED="$OUT/win-unpacked/resources/app.asar.unpacked/node_modules"
[ -f "$ASAR" ] || { echo "❌ 没找到 $ASAR（win-unpacked 没生成？）"; exit 1; }
STATS=$(node - "$ASAR" "$UNPACKED" "$APP_ABS/package.json" <<'EOF'
const a = require('@electron/asar');
const fs = require('fs');
const [asar, unpacked, pkgPath] = process.argv.slice(2);
const l = a.listPackage(asar);
const inAsar = new Set(l.map((x) => {
  const m = x.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)(\/|$)/);
  return m ? m[1] : null;
}).filter(Boolean));
let un = new Set();
try { un = new Set(fs.readdirSync(unpacked)); } catch (e) {}
const all = new Set([...inAsar, ...un]);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const deps = Object.keys(pkg.dependencies || {});
const missing = deps.filter((d) => !all.has(d));
const outMain = l.some((x) => /^\/out\/main\/index/.test(x));
const outPre = l.some((x) => /^\/out\/preload\//.test(x));
const outRen = l.some((x) => /^\/out\/renderer\//.test(x));
const native = l.filter((x) => /\.node$/.test(x)).length;
console.log(JSON.stringify({ top: inAsar.size, deps: deps.length, missing, outFiles: l.filter((x) => /^\/out\//.test(x)).length, outMain, outPre, outRen, native }));
EOF
)
echo "   $STATS"
node -e '
const s = JSON.parse(process.argv[1]);
const bad = s.missing.length > 0 || !s.outMain || !s.outPre || !s.outRen;
console.log(`   顶层包 ${s.top}（参考值；CI 正品 174）· 直接依赖 ${s.deps} 个，缺失 ${s.missing.length}${s.missing.length ? " → " + s.missing.join(", ") : ""}`);
console.log(`   out/ 文件 ${s.outFiles}（CI 正品 1864）· main ${s.outMain ? "✓" : "✗"} preload ${s.outPre ? "✓" : "✗"} renderer ${s.outRen ? "✓" : "✗"} · 原生 .node ${s.native}`);
console.log(bad ? "   ❌ 校验不过：依赖不全或 out/ 不完整 ⇒ 别交付" : "   ✅ 合格（要更严就按 OPS §三 拿 CI 正品逐包对比）");
process.exit(bad ? 1 : 0);
' "$STATS" || exit 1

echo "=== ⑥ 交付路径 + 指纹 ==="
ls -l --time-style=+%m-%d\ %H:%M "$EXE" | sed 's/^/   /'
file -b "$EXE" | cut -c1-90 | sed 's/^/   file: /'
sha256sum "$EXE" | sed 's/^/   sha256: /'
echo "=== ✅ 完成：$EXE （拷到 Windows 覆盖安装即可）==="
