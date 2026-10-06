#!/bin/bash
# [XG-CUSTOM] 2026-10-05 —— 本机 AppImage 打包**唯一推荐入口** —— 顺手堵上「静默缺包」这条坑。
#
# 为什么需要它（2026-10-05 我自己真踩了，且**差点装上一份启动即崩的包**）：
#   electron-builder 26 的包管理器探测（`app-builder-lib/out/node-module-collector/packageManager.js`）
#   顺序是 ① app 目录 `package.json#packageManager` → ② app 目录的 lockfile
#          → ③ 环境变量 `npm_config_user_agent` / `npm_execpath` → ④ 兜底 npm。
#   `apps/emdash-desktop/` 里既没有 `packageManager` 字段也没有 lockfile；而**直接调
#   `../../node_modules/.bin/electron-builder`**（老 OPS 里那条命令）时 UA 里没有 pnpm
#   ⇒ 走 **npm** 收集器 ⇒ 30 个直接依赖全报 `cannot find path for dependency …@undefined`
#   ⇒ asar 顶层 node_modules **561 → 168**、整包小 131MB（`@emdash/core`、原生 `.node` 全没了）。
#   实测对照：带 pnpm UA 重打 → 顶层 **561 = 561**、`@emdash/core` **2884 = 2884**、原生 **14 = 14**。
#   （`pnpm run package:linux` 之所以没这个病，是因为 `pnpm run` 会把 UA 设成 pnpm。）
#
# 用法: bash scripts/xg-package-linux.sh            # 打完**校验通过**才替换到 release/
#       XG_ALLOW_DIRTY=1 bash scripts/xg-package-linux.sh   # 明知有别人的 WIP 也要打（会编进包）
# 退出码: 0 = 已打出并校验通过的包；非 0 = 没打成 / 校验没过（**不会**动 release/ 里在用的包）
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
APP=apps/emdash-desktop
APP_ABS="$(pwd)/$APP"
PKG="$APP_ABS/release-new/emdash-x86_64.AppImage"
EXPECT_TOP=${XG_EXPECT_TOP_MODULES:-500}          # asar 顶层 node_modules 下限（正常 561）

echo "=== ① 打包前检查（未提交改动会被编进包！脚本自己那句提示是错的，见文件头）==="
if [ "${XG_ALLOW_DIRTY:-}" = "1" ]; then
  bash scripts/xg-pre-package.sh --force || true
else
  bash scripts/xg-pre-package.sh || { echo "❌ 树不干净；确认要带 WIP 打就加 XG_ALLOW_DIRTY=1"; exit 1; }
fi

echo "=== ② 编译（electron-vite build）==="
# [XG-CUSTOM] 2026-10-06 —— **先清 `out/` 再编译**（实测踩到）：`pnpm run build` 不会删掉上一轮
#   带内容哈希的旧 chunk，它们会被原样打进 app.asar ⇒ 包里同时存在**多份旧代码**。
#   实测（1.2.20-xiangwo 那次，两种打法的原始数字）：
#     · 不清：asar **893,218,107 B**（条目 42961）、AppImage **327,517,176 B**，
#             asar 里能搜到 **21 处**旧串 `socks5://100.125.4.119:1080`（新缺省只有 1 处）；
#     · 清了：asar **413,188,434 B**（条目 42162）、AppImage **231,559,337 B**，
#             旧串 **0 处**、新串 1 处（顶层包 561 / @emdash/core 2891 / 原生 14 三个判据不变）。
#   ⚠️ 那些旧 chunk **不在入口的 import 图里**（各自只被自己引用）⇒ 不影响功能，
#   但让包体积虚高 ~96MB，还会把「包里到底是哪版代码」的审计变成猜谜 —— 所以必须清。
rm -rf "$APP/out"
(cd "$APP" && pnpm run build) || { echo "❌ 编译失败"; exit 1; }

echo "=== ③ 打包（显式带 pnpm UA —— 文件头那个坑就靠这一行）==="
UA="pnpm/10.28.2 npm/? node/$(node -v) $(uname -s | tr '[:upper:]' '[:lower:]') $(uname -m)"
(cd "$APP" && rm -rf release-new && npm_config_user_agent="$UA" \
  ../../node_modules/.bin/electron-builder --linux AppImage --publish never \
  --config electron-builder.config.ts -c.directories.output=release-new) || { echo "❌ 打包失败"; exit 1; }
[ -f "$PKG" ] || { echo "❌ 没找到产物 $PKG"; exit 1; }

echo "=== ④ 校验 asar：防「静默缺包」（顶层包数 / workspace 包 / 原生模块）==="
TMP=$(mktemp -d /tmp/xg-pkg-check-XXXXXX)
(cd "$TMP" && "$PKG" --appimage-extract 'resources/app.asar' >/dev/null 2>&1)
ASAR="$TMP/squashfs-root/resources/app.asar"
[ -f "$ASAR" ] || { echo "❌ 解不出 app.asar"; rm -rf "$TMP"; exit 1; }
STATS=$(node - "$ASAR" <<'EOF'
const a = require('@electron/asar');
const l = a.listPackage(process.argv[2]);
const top = new Set(
  l
    .map((x) => {
      const m = x.match(/^\/node_modules\/((?:@[^/]+\/)?[^/]+)(\/|$)/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
);
const core = l.filter((x) => /\/node_modules\/@emdash\/core\//.test(x)).length;
const native = l.filter((x) => /\.node$/.test(x)).length;
console.log(JSON.stringify({ top: top.size, core, native, total: l.length }));
EOF
)
rm -rf "$TMP"
echo "   $STATS"
TOP=$(printf '%s' "$STATS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).top))')
CORE=$(printf '%s' "$STATS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).core))')
if [ "${TOP:-0}" -lt "$EXPECT_TOP" ] || [ "${CORE:-0}" -eq 0 ]; then
  echo "❌ 校验不过：顶层包 $TOP（应 ≥$EXPECT_TOP）/ @emdash/core 条目 $CORE（应 >0）"
  echo "   ⇒ 这就是「按 npm 收集」的缺包形态（见文件头）。**没有替换 release/ 里在用的包。**"
  echo "   排查：确认用了本脚本（UA 带 pnpm）、或给 $APP/package.json 加 \"packageManager\" 字段。"
  exit 1
fi
echo "   ✅ 顶层包 $TOP ≥ $EXPECT_TOP，且 @emdash/core 在包里"

echo "=== ⑤ 原子替换（先备份在用的那份，名字带 .bak- 不会被 pre-check 当脏）==="
# ⚠️ 必须用 `mv`（rename）而不是就地覆盖：正在跑的实例把 AppImage 以 FUSE 只读挂载着，
#    覆盖同一 inode 会让它的后续读失败（可能崩）；rename 只换目录项，**跑着的旧实例照旧活着**，
#    等 `systemctl --user restart emdash` 或下次登录才切到新包（2026-10-05 实测：12:17 替换时
#    11:38 起的那个实例继续正常工作）。
REL="$APP_ABS/release"
KEEP_BAK=${XG_KEEP_BAK:-3}                # 只留最近 N 份备份（每份 ~320MB，别把盘堆满）
if [ -f "$REL/emdash-x86_64.AppImage" ]; then
  BAK="$REL/emdash-x86_64.AppImage.bak-$(date +%Y%m%d-%H%M)"
  cp -p "$REL/emdash-x86_64.AppImage" "$BAK" && echo "   旧包备份 → $BAK"
fi
mv -f "$PKG" "$REL/emdash-x86_64.AppImage" || { echo "❌ 替换失败"; exit 1; }
rm -rf "$APP_ABS/release-new"          # 收走解包目录（~1GB），别堆在仓库里
# 备份只留最近 KEEP_BAK 份（按 mtime；`ls -t` 不认 `--time-style`，这里只用路径）
ls -t "$REL"/emdash-x86_64.AppImage.bak-* 2>/dev/null | tail -n "+$((KEEP_BAK + 1))" | while read -r old; do
  rm -f "$old" && echo "   清理旧备份（只留最近 $KEEP_BAK 份）→ $(basename "$old")"
done
# 清掉「被 kill -9 / 异常退出」留下的 FUSE 挂载点（活着的实例别动）
for m in $(mount | awk '/mount_emdash/ {print $3}'); do
  pid=$(ls -l /proc/*/exe 2>/dev/null | grep -c "$m" || true)
  if [ "${pid:-0}" -eq 0 ]; then
    (fusermount3 -u "$m" 2>/dev/null || fusermount -u "$m" 2>/dev/null) && echo "   清掉残留挂载 $m"
  fi
done
ls -l --time-style=+%m-%d\ %H:%M "$REL/emdash-x86_64.AppImage"
md5sum "$REL/emdash-x86_64.AppImage"
echo "=== ✅ 完成。让新包生效： systemctl --user restart emdash   （⚠️ 别 kill，Restart=always 会立刻拉回旧 PID）==="
