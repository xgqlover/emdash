#!/bin/bash
# [XG-CUSTOM 2026-10-09] —— **本机打 Windows exe**（NSIS 单文件）的入口，照 `xg-package-linux.sh` 的纪律。
#
# 为什么需要它：以前 exe 只能走 GitHub Actions（`windows-2022` runner）——
#   2026-10-09 账号 Actions 因计量额度用满被停（`gh workflow run` 恒 422），而本机**已经有 wine**
#   （`/opt/deepin-wine8-stable/bin/wine` = wine-8.16，以前 MEMORY 记的"缺 wine"已不成立）
#   ⇒ 本机也能打 NSIS 单文件 exe。**不上传源码、不等 CI、不花钱。**
#
# 🔴 六条铁律（别省任何一条）：
#   ① **依赖收集器必须是 pnpm** —— 否则走 npm 收集器 ⇒ 静默缺包。本脚本显式带 pnpm UA，
#      并且 app 的 package.json 已声明 `"packageManager": "pnpm@10.28.2"`（双保险）。
#      ⚠️ 别再拿"顶层包 ≥500 / @emdash/core 在包里"当判据 —— **CI 正品同样是 0**（那是 electron-vite 打进 out/ 的）。
#   ② **`--config electron-builder.config.ts` 不能省** —— 省了会拿包名 `@emdash/emdash-desktop`
#      当 executableName ⇒ 产物名变成 `@...exe`。
#   ③ [XG-CUSTOM 2026-10-12] **win32 可选依赖**只能在**构建目录**里装：
#      `pnpm-workspace.yaml` 的 `supportedArchitectures` 必须写 `os: [current, win32]`
#      （**只写 `[win32]` 会把 Linux 侧依赖剥掉 ⇒ 构建失败**），而工作区根那个文件**是被跟踪的**。
#   ④ [XG-CUSTOM 2026-10-12] ★ **原生 `.node` 的平台**才是那个致命坑（见下面「设计选择」）。
#   ⑤ [XG-CUSTOM 2026-10-12] **`git archive HEAD` 的临时克隆**里跑全程 —— 共用工作区零改动。
#   ⑥ [XG-CUSTOM 2026-10-12] **打完必经 `scripts/xg-verify-win-exe.sh` 验收**，不过就非 0 退出。
#
# 🔴 [XG-CUSTOM 2026-10-12] 设计选择 = (b) **临时克隆**，而不是 (a)「原地换 + 结束还原」。理由与代价：
#   · 病根：本机 `pnpm install` 出来的 `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
#     是 **Linux ELF**，而 `electron-builder.config.ts` 是 `npmRebuild:false`（打包**不**重编）
#     ⇒ ELF 被原样收进包 ⇒ 真机启动即 `…better_sqlite3.node is not a valid Win32 application`
#     （Emdash Recovery）。旧脚本只检查"win32 可选依赖在不在"，**从没查过这份 `.node` 是哪个平台的**。
#   · 为什么否掉 (a)：原生件就在**共用** `node_modules` 里，此刻**另一条线可能在跑 `pnpm dev`/测试/打
#     AppImage** —— 换掉的那几分钟他们拿到的是 win32 的 `.node`；而且 win32 可选依赖也得装进共用
#     `node_modules`、还得改被跟踪的 `pnpm-workspace.yaml`（工作区变脏 ⇒ 别人的 pre-check 直接失败）；
#     最后 (a) 靠 trap 还原，`kill -9` 就漏，会把工作区留成"只能在 Windows 上跑"。
#   · (b) 的实测代价（本机 2026-10-12）：`git archive HEAD`（99 MB）+ 克隆里 `pnpm install --prefer-offline`
#     （store 全命中：**3.4 秒**，`reused 1520 / downloaded 0`）≈ 2.2 GB 磁盘（pnpm 硬链接自 store，新增极少）。
#     ⇒ **可测判据：跑完本脚本，共用工作区那份 `.node` 的 md5 不变**（脚本全程只读源仓）。
#   · ⚠️ 语义变化：克隆 = **HEAD 的确切内容**（`git archive`）；`XG_ALLOW_DIRTY=1` 时会再把**未提交改动**
#     （含未跟踪但非忽略的文件）覆盖进克隆 = 旧脚本"WIP 也编进包"的行为。
#
# 用法: bash scripts/xg-package-win.sh
#       XG_ALLOW_DIRTY=1 bash scripts/xg-package-win.sh      # 树脏（别人的 WIP）也打；WIP 会覆盖进克隆
#       XG_WINE_BIN=/usr/bin bash scripts/xg-package-win.sh  # 换 wine 位置
#       XG_WIN_KEEP_CLONE=1 ...                              # 保留构建克隆（排查用）
#       XG_WIN_BUILD_ROOT=/home/me/tmp ...                   # 克隆放哪（默认 $TMPDIR 或 /tmp）
#       XG_WIN_OUT_DIR=/path ...                             # 产物拷到哪（默认 ~/Desktop）
#       XG_VERIFY_STRINGS="串A|串B" ...                       # 覆盖验收闸门的"关键代码串"
#       XG_WIN_DELIVER_TEST=1 bash scripts/xg-package-win.sh  # **廉价自测**：跳过真构建，
#                                                            #   只造"目标已存在且内容不同"的假产物，
#                                                            #   走完 ⑩ 归档/拷/校验/manifest（不用 wine）
# 退出码: 0 = 打出并通过验收（产物已拷到 `XG_WIN_OUT_DIR`）；非 0 = 没打成/验收没过（**不动 release/ 里在用的东西**）
#
# 🔴 [XG-CUSTOM 2026-10-12] **改脚本必重跑端到端**（死规矩，两条）：
#   ① 本脚本**改动一行**就必须**重跑一次真构建**（`bash scripts/xg-package-win.sh`）——
#      因为"提交版脚本 ≠ 端到端跑过的脚本"会让「这包是哪份脚本打的」永久无法证明
#      （2026-10-12 实际踩到：提交版与跑过的差 1 行，而那一行所在分支当次没走到）。
#   ② 没重跑过就不许把产物当"已验证"交付 —— 要么重跑，要么在产物名/manifest 里显式标 **「未验证」**。
#   📌 廉价自测（`XG_WIN_DELIVER_TEST=1`）**只能证明交付段的逻辑**，**不能**替代 ① 的端到端（它不构建）。
set -uo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"      # 源仓（共用工作区）—— 本脚本只读它
cd "$SRC" || exit 1
# [XG-CUSTOM 2026-10-12] 「这包是哪份脚本打的」可证：脚本自身 md5 + git commit 一开头就落盘（日志 + manifest）。
SELF_MD5="$(md5sum "$0" | cut -d' ' -f1)"
HEAD_FULL="$(git rev-parse HEAD 2>/dev/null)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then HEAD_TAG="${HEAD_FULL}+dirty"; else HEAD_TAG="$HEAD_FULL"; fi
BUILD_TS="$(date +%Y-%m-%dT%H:%M:%S%z)"
echo "=== xg-package-win.sh 身份（可证「这包是哪份脚本打的」）==="
echo "   脚本: $0"
echo "   脚本 md5: $SELF_MD5"
echo "   git HEAD: ${HEAD_TAG:-（读不到）}"
echo "   时间: $BUILD_TS"
APP_REL=apps/emdash-desktop
APP="$SRC/$APP_REL"
VER_APP="$(node -p "require('$APP/package.json').version" 2>/dev/null)"
[ -n "$VER_APP" ] && [ "$VER_APP" != "undefined" ] || { echo "❌ 读不到 $APP_REL/package.json 的 version"; exit 1; }
EXPECT_TOP=${XG_EXPECT_TOP_MODULES:-500}          # 只用来打印参考值；真正的判据见 ⑧

# ============================================================================
# [XG-CUSTOM 2026-10-12] ⑩/⑪ 交付段 = **归档 → 拷贝 → md5 校验 → 写 manifest**
#   为什么抽成函数：真实交付与 `XG_WIN_DELIVER_TEST=1` 的**廉价自测必须走同一份代码**
#   （否则"自测通过"证明不了交付段；本项目的病就是"以为验了"）。
#   入参：outdir / exe / note("端到端"|"自测")
#   依赖：$GATE_RC · $GATE_HITS/$GATE_STRINGS · 全局 SELF_MD5/HEAD_TAG/BUILD_TS/VER_APP（调用时才用到）
# ============================================================================
xg_md5() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

xg_deliver() {
  local outdir="$1" exe="$2" note="$3"
  local name dest src_md5 dest_md5 i
  name="$(basename "$exe")"
  dest="$outdir/$name"
  mkdir -p "$outdir" || { echo "❌ 建不了 $outdir"; return 1; }
  src_md5="$(xg_md5 "$exe")"
  BAK=""
  # ── 覆盖前：同名且内容不同 ⇒ **先归档**；归档失败 ⇒ 不许往下走（非 0）
  if [ -f "$dest" ] && [ "$(xg_md5 "$dest")" != "$src_md5" ]; then
    echo "   [归档分支] 同名但内容不同 ⇒ 先归档（源 md5=$src_md5，旧 md5=$(xg_md5 "$dest")）"
    BAK="$dest.bak-$(date +%Y%m%d-%H%M)"
    i=1
    while [ -e "$BAK" ]; do BAK="$dest.bak-$(date +%Y%m%d-%H%M)-$i"; i=$((i+1)); done
    # 🔴 归档失败就**不许往下走**：2026-10-12 我在一条临时命令里写了 `mv …; echo 已备份`，
    #   mv 没生效而 echo 照样打印，紧接着的 `cp -f` 就把旧产物盖掉了（同一族老病：
    #   "拿容易取到的信号当判据"/`cmd | head && echo ✅` 永远打印）。
    if [ "${XG_WIN_TEST_ARCHIVE_RO:-}" = "1" ]; then
      echo "   [自测注入] XG_WIN_TEST_ARCHIVE_RO=1 ⇒ 假装归档不可写"
      echo "❌ 归档旧产物失败（注入）⇒ **不覆盖**，退出"; return 1
    fi
    mv -f "$dest" "$BAK" || { echo "❌ 归档旧产物失败（$dest → $BAK）⇒ **不覆盖**，退出"; return 1; }
    [ -f "$BAK" ] || { echo "❌ 归档后 $BAK 不存在 ⇒ 视为归档失败，**不覆盖**，退出"; return 1; }
    echo "   ⚠️ 同名但内容不同（可能是另一条线同版本的产物）⇒ 旧的已归档 → $BAK（$(stat -c %s "$BAK") 字节）"
  fi
  # ── 拷贝
  if [ "${XG_WIN_TEST_COPY_RC:-}" = "1" ]; then
    echo "   [自测注入] XG_WIN_TEST_COPY_RC=1 ⇒ 拷贝内容故意损坏（测下面那条 md5 判据）"
    printf 'corrupted-by-test\n' > "$outdir/.xg-test-corrupt" && cp -f "$outdir/.xg-test-corrupt" "$dest"
  else
    cp -f "$exe" "$dest" || { echo "❌ 拷不到 $dest"; return 1; }
  fi
  # ── 拷贝后：**立刻比对源与目标的 md5**；不一致 ⇒ 不许交付
  dest_md5="$(xg_md5 "$dest")"
  [ "$dest_md5" = "$src_md5" ] \
    || { echo "❌ 拷贝后 md5 不一致（源 $src_md5 ≠ 目标 $dest_md5）⇒ 不交付，退出"; return 1; }
  echo "   ✅ 拷贝后 md5 一致：$dest_md5"
  # ── 写 manifest（产物旁 `<exe>.manifest.txt`）
  xg_write_manifest "$dest" "$src_md5" "$note"
}

xg_write_manifest() {
  local dest="$1" md5v="$2" note="$3"
  local shaval bytes man tool file_out
  shaval="$(sha256sum "$dest" | cut -d' ' -f1)"
  bytes="$(stat -c %s "$dest")"
  man="$dest.manifest.txt"
  # 🔴 这个字段**只按"这份脚本这次是不是完整跑过端到端"来定**，别拿 note 反推：
  #   真路径（note="端到端"）走到这里 = 构建+结构校验+验收闸门+交付**全跑过** ⇒ yes；
  #   自测（note="自测"）不构建 ⇒ no。第一版这里写反了（端到端跑过却打 no），端到端实测抓出来的。
  tool="$([ "$note" = "端到端" ] && echo yes || echo 'no（未重跑端到端 ⇒ 不能当已验收）')"
  file_out="$(file -b "$dest" | cut -c1-90)"
  {
    echo "# emdash Windows exe 交付 manifest —— [XG-CUSTOM 2026-10-12]"
    echo "artifact           : $dest"
    echo "md5                : $md5v"
    echo "sha256             : $shaval"
    echo "bytes              : $bytes"
    echo "file               : $file_out"
    echo "version            : $VER_APP"
    echo "build_time         : $BUILD_TS"
    echo "git_commit         : ${HEAD_TAG:-unknown}   # 脏树时带 +dirty"
    echo "script             : $0"
    echo "script_md5         : $SELF_MD5   # ⇒ 「这包是哪份脚本打的」由这一行证明"
    echo "acceptance.gate_rc : $GATE_RC   # 验收闸门退出码（0 = 过；非 0 根本走不到这里）"
    echo "acceptance.strings : $GATE_HITS/$GATE_STRINGS   # 关键代码串命中数（在产物的 app.asar 里现数）"
    echo "acceptance.tool    : xg-verify-win-exe.sh"
    echo "archived_previous  : ${BAK:-（无：目标原本不存在或内容相同）}"
    echo "delivered_at       : $(date +%Y-%m-%dT%H:%M:%S%z)"
    echo "verified_end_to_end: $tool   # 改动本脚本后必须重跑端到端；否则产物标「未验证」"
  } > "$man" || { echo "❌ 写不了 manifest（$man）⇒ 不交付，退出"; return 1; }
  echo "   manifest: $man"
  sed 's/^/     /' "$man"
}

# ============================================================================
# [XG-CUSTOM 2026-10-12] ★ 廉价自测（`XG_WIN_DELIVER_TEST=1`）：**跳过真构建**，
#   只造"目标已存在且内容不同"的假产物 ⇒ 走完 ⑩ 的 归档/拷贝/校验/manifest ⇒ 自验 4 条判据。
#   为什么需要：交付段的分支（同名不同内容）在真构建里**很多次才走到一次**（今天就是"改了没走到"）。
#   ⚠️ 它**不构建**，所以**不能**替代"改脚本必重跑端到端"（见文件头两条死规矩）。
#   失败注入：`XG_WIN_TEST_ARCHIVE_RO=1`（归档不可写）· `XG_WIN_TEST_COPY_RC=1`（拷贝后 md5 不一致）。
# ============================================================================
if [ "${XG_WIN_DELIVER_TEST:-}" = "1" ]; then
  echo
  echo "=== [自测] XG_WIN_DELIVER_TEST=1：不构建，只测 ⑩ 交付段 ==="
  TD="$(mktemp -d /tmp/xg-win-deliver-test-XXXXXX)"
  trap - EXIT                      # 保住自测目录（要人工复核）
  NAME="emdash-${VER_APP}-x64.exe"
  EXE="$TD/$NAME"                  # 假产物（源）
  printf 'new-artifact-%s\n' "$(date +%s%N)" > "$EXE"
  OUTDIR="${XG_WIN_OUT_DIR:-$TD/out}"
  mkdir -p "$OUTDIR"
  printf 'old-stale-artifact-different-content\n' > "$OUTDIR/$NAME"   # 目标已存在且内容不同
  OLD_MD5="$(xg_md5 "$OUTDIR/$NAME")"
  GATE_RC=0
  GATE_HITS="n/a（自测不构建产物）"
  GATE_STRINGS="n/a"
  echo "   自测目录: $TD"
  echo "   源  (假产物): $EXE  md5=$(xg_md5 "$EXE")"
  echo "   目标(已存在): $OUTDIR/$NAME  md5=$(xg_md5 "$OUTDIR/$NAME")"
  xg_deliver "$OUTDIR" "$EXE" "自测" || { echo "❌ [自测] 交付段失败（rc=$?）"; exit 1; }
  # ── 自验 5 条判据（**打到目标自己的字段上**，不拿"打印过什么"当判据）
  TFAIL=0
  ARCH=""
  for _c in "$OUTDIR/$NAME".bak-*; do [ -e "$_c" ] && ARCH="$_c"; done
  [ -n "$ARCH" ] && [ -f "$ARCH" ]     || { echo "   ❌ 判据1：归档文件不存在"; TFAIL=1; }
  [ -n "$ARCH" ] && [ "$(xg_md5 "$ARCH")" = "$OLD_MD5" ] \
                                       || { echo "   ❌ 判据1b：归档内容 ≠ 原来的旧产物"; TFAIL=1; }
  [ "$(xg_md5 "$OUTDIR/$NAME")" = "$(xg_md5 "$EXE")" ] \
                                       || { echo "   ❌ 判据2：目标没被替换成源内容"; TFAIL=1; }
  [ -f "$OUTDIR/$NAME.manifest.txt" ]  || { echo "   ❌ 判据3：manifest 不存在"; TFAIL=1; }
  for k in md5 sha256 bytes version build_time git_commit script_md5 gate_rc; do
    grep -q "^[a-zA-Z._]*$k" "$OUTDIR/$NAME.manifest.txt" 2>/dev/null || { echo "   ❌ 判据4：manifest 缺字段 $k"; TFAIL=1; }
  done
  grep -q "^md5 *: $(xg_md5 "$OUTDIR/$NAME")" "$OUTDIR/$NAME.manifest.txt" \
                                       || { echo "   ❌ 判据5：manifest 里的 md5 ≠ 实际目标的 md5"; TFAIL=1; }
  grep -q "^script_md5 *: $(md5sum "$0" | cut -d' ' -f1)" "$OUTDIR/$NAME.manifest.txt" \
                                       || { echo "   ❌ 判据5b：manifest 里的 script_md5 ≠ 本脚本现算的 md5"; TFAIL=1; }
  echo "   --- manifest 实际内容 ---"
  sed 's/^/   | /' "$OUTDIR/$NAME.manifest.txt"
  echo "   --- 判据 ---"
  echo "   1 归档文件在        : ${ARCH:-缺失}（md5=$(xg_md5 "$ARCH") vs 原目标 $OLD_MD5）"
  echo "   2 目标已替换成源内容: md5=$(xg_md5 "$OUTDIR/$NAME")（源=$(xg_md5 "$EXE")）"
  echo "   3 manifest 存在     : $OUTDIR/$NAME.manifest.txt"
  echo "   4 manifest 关键字段 : $(grep -c -E '^(md5|sha256|bytes|version|build_time|git_commit|script_md5)' "$OUTDIR/$NAME.manifest.txt")/7"
  echo "   5 manifest↔实际一致 : md5 与 script_md5 都等于现算值"
  if [ "$TFAIL" != "0" ]; then echo "❌ [自测] 失败 ⇒ exit 1"; exit 1; fi
  echo "✅ [自测] 通过（退出码 0）"
  echo "   归档文件保留：$ARCH"
  echo "   自测目录保留：$TD（要清就 rm -rf）"

  # ── 失败注入 2：归档目标不可写 ⇒ 必须 exit 1（⚠️ 必须在**子 shell** 里跑：`exit 1` 只许退子 shell，
  #    否则它会连测试自己的进程一起带走）
  echo
  echo "=== [自测] 失败注入：归档不可写（XG_WIN_TEST_ARCHIVE_RO=1）⇒ 期望 exit 1，且**不覆盖**旧产物 ==="
  TD2="$(mktemp -d /tmp/xg-win-deliver-fail-XXXXXX)"
  mkdir -p "$TD2/out" "$TD2/src"
  printf 'keep-me-old\n' > "$TD2/out/$NAME"
  OLD_MD5="$(xg_md5 "$TD2/out/$NAME")"
  # ⚠️ 源必须**同名**（否则 `xg_deliver` 的 dest 会变成源自己，cp 会报"同一文件"、exit 1 来自拷贝而不是归档
  #    ⇒ 注入"看起来通过"却根本没测到归档分支 = 假通过）。放 src/ 子目录即可同名。
  printf 'new\n' > "$TD2/src/$NAME"
  ( BAK=""; export XG_WIN_TEST_ARCHIVE_RO=1
    xg_deliver "$TD2/out" "$TD2/src/$NAME" "自测-归档失败注入" ) ; RC=$?
  echo "   注入 rc=$RC（期望 1）"
  [ "$RC" = "1" ] || { echo "❌ [自测] 归档失败注入应当 exit 1"; exit 1; }
  [ "$(xg_md5 "$TD2/out/$NAME")" = "$OLD_MD5" ] || { echo "❌ [自测] 归档失败后旧产物被改动了"; exit 1; }
  ls "$TD2/out/$NAME".bak-* >/dev/null 2>&1 && { echo "❌ [自测] 归档失败却出现了归档文件"; exit 1; }
  echo "   ✅ 归档失败 ⇒ exit 1，且旧产物未被覆盖（md5=$OLD_MD5）、没留半个归档"

  # ── 失败注入 3：拷贝后 md5 不一致 ⇒ 必须 exit 1
  echo
  echo "=== [自测] 失败注入：拷贝后 md5 不一致（XG_WIN_TEST_COPY_RC=1）⇒ 期望 exit 1 ==="
  TD3="$(mktemp -d /tmp/xg-win-deliver-corrupt-XXXXXX)"
  printf 'source-content\n' > "$TD3/$NAME"
  SRC3_MD5="$(xg_md5 "$TD3/$NAME")"
  ( BAK=""; export XG_WIN_TEST_COPY_RC=1
    xg_deliver "$TD3" "$TD3/$NAME" "自测-拷贝损坏注入" ) ; RC3=$?
  echo "   注入 rc=$RC3（期望 1）"
  [ "$RC3" = "1" ] || { echo "❌ [自测] 拷贝 md5 不一致应当 exit 1"; exit 1; }
  # 再验"确实是坏在 md5 判据上"：目标的 md5 必须 ≠ 源的 md5
  [ "$(xg_md5 "$TD3/$NAME")" != "$SRC3_MD5" ] || { echo "❌ [自测] 注入后目标竟与源一致（注入没生效）"; exit 1; }
  echo "   ✅ 拷贝 md5 不一致 ⇒ exit 1（目标 md5=$(xg_md5 "$TD3/$NAME") ≠ 源 $SRC3_MD5）"
  echo
  echo "=== ✅ [自测] 全部通过：正路 exit 0 + 两条失败注入都 exit 1 ==="
  exit 0
fi
export ELECTRON_MIRROR=${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}
export ELECTRON_BUILDER_BINARIES_MIRROR=${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}
WINE_BIN=${XG_WINE_BIN:-/opt/deepin-wine8-stable/bin}
export PATH="$WINE_BIN:$PATH"

echo "=== ① 前置（宿主）：wine / 版本 / 镜像 ==="
command -v wine >/dev/null || { echo "❌ PATH 里没有 wine（用 XG_WINE_BIN=... 指一个）"; exit 1; }
echo "   wine: $(wine --version 2>/dev/null)"
echo "   版本: $VER_APP（来自 $APP_REL/package.json）"
echo "   镜像: $ELECTRON_MIRROR"

echo "=== ② 树干净检查（**对源仓**做；克隆里没有 .git）==="
# [XG-CUSTOM 2026-10-12] 这一步必须在**源仓**做：克隆是 `git archive` 出来的、没有 `.git`。
#   📌 从这个版本起，pre-check 里那句"打包读的是【已提交】的代码"**才是真的**
#      （克隆 = HEAD 的确切内容；只有 XG_ALLOW_DIRTY=1 才会把 WIP 覆盖进去）。
if [ "${XG_ALLOW_DIRTY:-}" = "1" ]; then
  bash scripts/xg-pre-package.sh --force || true
else
  bash scripts/xg-pre-package.sh || { echo "❌ 树不干净；确认要带 WIP 打就加 XG_ALLOW_DIRTY=1"; exit 1; }
fi

echo "=== ③ 建构建克隆（mktemp -d + git archive HEAD；共用工作区零改动）==="
BUILD_ROOT="${XG_WIN_BUILD_ROOT:-${TMPDIR:-/var/tmp/xg-tmp}}"
mkdir -p "$BUILD_ROOT" || { echo "❌ 建不了 $BUILD_ROOT"; exit 1; }
CLONE="$(mktemp -d "$BUILD_ROOT/xg-pack-win-XXXXXX")" || { echo "❌ mktemp 失败（$BUILD_ROOT）"; exit 1; }
cleanup() {
  if [ "${XG_WIN_KEEP_CLONE:-}" = "1" ] || [ "${XG_WIN_DELIVER_TEST:-}" = "1" ]; then echo "== 克隆/构建目录保留（排查/自测用）：$CLONE"
  else rm -rf "$CLONE"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
git archive HEAD | tar -x -C "$CLONE" || { echo "❌ git archive HEAD 失败"; exit 1; }
DIRTY_NOTE=""
if [ "${XG_ALLOW_DIRTY:-}" = "1" ]; then
  # 把未提交改动覆盖进克隆（= 旧脚本"WIP 也编进包"的行为）。
  # `--exclude-standard` 让 gitignore 的（node_modules / release / out / dist…）自动不进列表；
  #   `-z`+`--null` 是为了扛住带空格/换行的文件名。
  git diff --name-only --diff-filter=d HEAD -z | tar -C "$SRC" --null -c -f - -T - | tar -x -C "$CLONE" -f -
  git ls-files --others --exclude-standard -z | tar -C "$SRC" --null -c -f - -T - | tar -x -C "$CLONE" -f -
  DIRTY_NOTE=" + 未提交改动($(git status --porcelain | wc -l) 项)"
  echo "   ⚠️ XG_ALLOW_DIRTY=1：已把未提交改动覆盖进克隆（HEAD = $(git rev-parse --short HEAD)$DIRTY_NOTE）"
fi
echo "   克隆: $CLONE（内容 = $(git rev-parse --short HEAD)${DIRTY_NOTE}）"

echo "=== ④ 【只在克隆里】win32 可选依赖（supportedArchitectures 不能动共用工作区）==="
# [XG-CUSTOM 2026-10-09] 在 Linux 上 `pnpm install` 装出来的是 **linux 版**可选依赖
#   （`@parcel/watcher-linux-x64-glibc` / `@typescript/native-preview-linux-x64`），而 CI 在 Windows runner
#   上装的是 win32 版 ⇒ 打出来的包会缺 win 侧实现（文件监听/TS 原生预览退化）。
#   🔴 `os` 必须写 `[current, win32]`：**只写 `[win32]` 会把 Linux 侧依赖剥掉 ⇒ 构建直接失败**。
#   🔴 这行**只能在克隆里**加（工作区根那份 `pnpm-workspace.yaml` 是被跟踪的，改了别人的 pre-check 就失败）。
{
  echo ''
  echo '# [XG-CUSTOM 2026-10-12] 本机打 win 包：**在克隆里**加 win32 侧可选依赖（保留 current，别只写 win32）'
  echo 'supportedArchitectures:'
  echo '  os: [current, win32]'
  echo '  cpu: [x64]'
} >> "$CLONE/pnpm-workspace.yaml"
sed 's/^/   /' "$CLONE/pnpm-workspace.yaml"
# `--prefer-offline`：store/缓存命中就不走网（实测 3.4 秒、downloaded 0）。
if ! (cd "$CLONE" && pnpm install --frozen-lockfile --prefer-offline > "$CLONE/.xg-install.log" 2>&1); then
  echo "❌ 克隆里 pnpm install 失败（尾部 30 行）："; tail -30 "$CLONE/.xg-install.log" | sed 's/^/   /'; exit 1
fi
tail -2 "$CLONE/.xg-install.log" | sed 's/^/   /'
MISS_PLAT=0
for m in "@parcel/watcher-win32-x64" "@typescript/native-preview-win32-x64"; do
  [ -e "$CLONE/node_modules/$m" ] || { MISS_PLAT=1; echo "   ❌ 缺 win32 可选依赖：node_modules/$m"; }
done
if [ "$MISS_PLAT" = "1" ]; then
  echo "   ⇒ 上面那条 supportedArchitectures 没生效（或 lockfile 太旧）⇒ 打出来的包与 CI 正品构成不一致。"
  exit 1
fi
echo "   ✅ win32 可选依赖在位"

echo "=== ⑤ ★ 原生件平台判据 + 自动换 win32（今天那个致命坑的正解）==="
# 判据 = 「这份 `.node` 是不是 win32 的 PE」——**只有它能防住 ELF 混进 win 包**；
#   「asar 里有没有这个文件 / 顶层包够不够」永远发现不了。
BS="$CLONE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[ -f "$BS" ] || { echo "❌ 克隆里没有 $BS"; exit 1; }
# electron 版本**从仓里读**（克隆里 `pnpm install` 装的那份 = 真正会被打进包的 Electron），别写死。
ELEC_VER="$(node -p "require('$CLONE/node_modules/electron/package.json').version" 2>/dev/null)"
ELEC_BIN="$CLONE/node_modules/electron/dist/electron"
ABI="$(ELECTRON_RUN_AS_NODE=1 "$ELEC_BIN" -p 'process.versions.modules' 2>/dev/null | tr -d '[:space:]')"
plat() { head -c 2 "$1" | od -An -c | tr -d ' \n'; }     # `MZ` = PE；`\177ELF` = Linux
echo "   electron $ELEC_VER（ABI ${ABI:-?}，来自克隆里 node_modules/electron）"
echo "   换前: $(plat "$BS") / $(file -b "$BS")"
if [ "$(plat "$BS")" != "MZ" ]; then
  echo "   ⇒ 不是 PE（MZ）⇒ 自动装 win32 x64 预编译："
  echo "     prebuild-install --runtime=electron --target=$ELEC_VER --platform=win32 --arch=x64 -d"
  # ⚠️ 这个版本 prebuild-install 的 `-d` = **`--download`**（`rc.js` 里 `download: 'd'`），**不是 --debug**。
  #    有缓存（`${npm_config_cache:-~/.npm}/_prebuilds`）时它直接解缓存、不走网。
  if ! ( cd "$CLONE/node_modules/better-sqlite3" && "$CLONE/node_modules/.bin/prebuild-install" \
        --runtime=electron --target="$ELEC_VER" --platform=win32 --arch=x64 -d ); then
    echo "❌ 换 win32 原生件失败（无网且无缓存？缓存路径 = \${npm_config_cache:-~/.npm}/_prebuilds）"; exit 1
  fi
fi
# 三条判据，任一条不过就**拒绝打包**（宁可不打，也不出"装到 Windows 就崩"的包）：
#   ① 头两字节 `MZ`（PE 魔数，比 `file` 更底层） ② `file` 说 PE32+（Windows x64 的 DLL 形状）
#   ③ 导出 `node_register_module_v<ABI>`（回答"是不是给**这个** Electron 编的"，`file` 回答不了）
BS_PLAT="$(plat "$BS")"; BS_FILE="$(file -b "$BS")"
echo "   换后: $BS_PLAT / $BS_FILE"
[ "$BS_PLAT" = "MZ" ] || { echo "❌ better_sqlite3.node 头两字节不是 MZ（还是宿主平台的 ELF？）"; exit 1; }
case "$BS_FILE" in *PE32+*) ;; *) echo "❌ better_sqlite3.node 不是 PE32+：$BS_FILE"; exit 1;; esac
if [ -n "$ABI" ]; then
  grep -a -q -F -- "node_register_module_v$ABI" "$BS" \
    || { echo "❌ 没有导出 node_register_module_v$ABI ⇒ ABI 不对（真机症状 NODE_MODULE_VERSION）"; exit 1; }
  echo "   ✅ 判据通过：MZ + PE32+ + node_register_module_v$ABI（md5 $(md5sum "$BS" | cut -d' ' -f1)）"
else
  echo "   ⚠️ 问不到 electron 的 ABI（$ELEC_BIN 不可执行）⇒ 只验 MZ + PE32+"
fi

echo "=== ⑥ 编译 ==="
# [XG-CUSTOM 2026-10-12] 克隆是干净的 HEAD ⇒ `packages/*/dist` 不存在（gitignore 的）⇒ **必须先跑根 build**，
#   否则 rollup 报 `Failed to resolve import "@emdash/wire/worker"`（文档"坎 2"）。
#   `NX_NO_CLOUD=true NX_DAEMON=false` 防 nx 云请求 600s 超时（文档"坎 3"）。
if ! (cd "$CLONE" && NX_NO_CLOUD=true NX_DAEMON=false pnpm run build > "$CLONE/.xg-build-root.log" 2>&1); then
  echo "❌ 根 build 失败（尾部 30 行）："; tail -30 "$CLONE/.xg-build-root.log" | sed 's/^/   /'; exit 1
fi
echo "   根 build 完成（$(ls -d "$CLONE"/packages/*/dist 2>/dev/null | wc -l) 个 packages/*/dist）"
# 先清 `out/`，防带内容哈希的旧 chunk 混进包（实测：不清会让 asar 里同时存在多份旧代码）。
rm -rf "$CLONE/$APP_REL/out"
(cd "$CLONE/$APP_REL" && pnpm run build) || { echo "❌ 编译失败"; exit 1; }

echo "=== ⑦ 打包（--win nsis，显式带 pnpm UA）==="
UA="pnpm/10.28.2 npm/? node/$(node -v) linux x86_64"
OUT="$CLONE/$APP_REL/release-new"
# `npm_package_version` 必须显式给：本脚本是**直接调** electron-builder（不走 `pnpm run`）⇒ npm 不会注入它，
#   而 `electron-builder.config.ts` 的 artifactName 兜底（jiti 下取不到 ARTIFACT_PREFIX 时）就靠它
#   —— 同 `xg-package-linux.sh` 的做法。
if ! (cd "$CLONE/$APP_REL" && rm -rf release-new && npm_config_user_agent="$UA" npm_package_version="$VER_APP" \
      "$CLONE/node_modules/.bin/electron-builder" --win nsis --publish never \
      --config electron-builder.config.ts -c.directories.output=release-new); then
  echo "❌ 打包失败"; exit 1
fi
ls -l "$OUT" 2>/dev/null | sed 's/^/   /'
# [XG-CUSTOM 2026-10-12] 产物名**带版本**（`emdash-<版本>-x64.exe`）—— 老写法死找 `emdash-x64.exe`，
#   会"exe 明明打出来了却报没找到产物并 exit 1"（真机踩过，见 `119215d05`）⇒ 后面的 asar 校验与验收全被跳过。
#   先按**带版本**的 glob 找（排除 `__uninstaller.exe` 中间物），再退回老名。
EXE=""
for _c in $(ls -1 "$OUT"/emdash-*-x64.exe 2>/dev/null | grep -v '__uninstaller' | sort -r); do EXE="$_c"; break; done
if [ -z "$EXE" ]; then [ -f "$OUT/emdash-x64.exe" ] && EXE="$OUT/emdash-x64.exe"; fi
[ -n "$EXE" ] && [ -f "$EXE" ] || {
  echo "❌ 没找到产物（找过：$OUT/emdash-*-x64.exe 与 $OUT/emdash-x64.exe）—— $OUT 里实际有："
  ls -la "$OUT" 2>/dev/null | sed 's/^/     /' | head -12
  exit 1
}
echo "   产物：$EXE（$(stat -c %s "$EXE") 字节）"

echo "=== ⑧ 结构校验：★ 正确判据（旧的「顶层包 ≥500」已过期，见 emdash-Windows-exe-本机打包-2026-10-09.md §三）==="
# 为什么旧判据错：本仓 electron-builder 配置有一条 [XG-CUSTOM] 显式收集清单，**只收 emdash-desktop 的直接依赖**；
#   workspace 包（@emdash/core 等）是 electron-vite 打进 `out/` 的 ⇒ 本来就不在 node_modules 里。
#   CI 正品实测同样是「顶层包 0 个 @emdash/core」。
# 正确判据 = ① app 的每个 dependencies 都在包里 ② out/ 的 main/preload/renderer 都在。
ASAR="$OUT/win-unpacked/resources/app.asar"
UNPACKED="$OUT/win-unpacked/resources/app.asar.unpacked/node_modules"
[ -f "$ASAR" ] || { echo "❌ 没找到 $ASAR（win-unpacked 没生成？）"; exit 1; }
STATS=$(node - "$ASAR" "$UNPACKED" "$CLONE/$APP_REL/package.json" <<'EOF'
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

echo "=== ⑨ ★ 验收闸门：xg-verify-win-exe.sh（**必经步骤**；不过就非 0 退出）==="
# 用**源仓**那份脚本（不是克隆里的那份）：它自己的 `ROOT` 指向源仓 ⇒ 期望版本与 electron ABI
#   都从源仓现读（版本写死就变成"永远通过/永远失败"两种假信号）。
# 关键代码串：默认这两条来自最近"球点链接/图片卡 → 开内嵌浏览器"那条链的**真实代码串**
#   （HEAD 里分别出现在 15 / 7 个源文件），可被 `XG_VERIFY_STRINGS` 覆盖（`|` 分隔）。
# 🔴 必须给**结尾换行**：`xg-verify-win-exe.sh` 的 ⑤ 是
#   `while IFS= read -r s; do … done < <(printf '%s' "$XG_VERIFY_STRINGS" | tr '|' '\n')`，
#   而 `printf '%s'` **不带结尾换行** ⇒ `read` 在最后一行因"EOF 且无换行"返回非 0 ⇒ **循环体不执行**：
#   单串时整段**静默跳过**、多串时**最后一个串从不被验**（本会话实测：
#   `XG_VERIFY_STRINGS='不存在的串' bash scripts/xg-verify-win-exe.sh <exe>` 仍然 ✅ / exit 0 = 假通过）。
#   这里补一个结尾换行绕开它 —— **不改** `xg-verify-win-exe.sh`（那份归另一条线；已在本会话报告里说明）。
VSTR="${XG_VERIFY_STRINGS:-openEmbeddedBrowser|开内嵌浏览器}"
echo "   关键代码串（按串逐个验）：$VSTR"
if XG_VERIFY_STRINGS="$VSTR"$'\n' bash "$SRC/scripts/xg-verify-win-exe.sh" "$EXE"; then
  GATE_RC=0
else
  GATE_RC=$?
  echo "❌ 验收不过（退出码 $GATE_RC）⇒ **不交付**（exe 只在克隆里，克隆退出即删；要复核加 XG_WIN_KEEP_CLONE=1）"
  exit 1
fi
# [XG-CUSTOM 2026-10-12] 验收结论进 manifest：**闸门退出码** + **关键串命中数**。
#   命中数在**产物自己的 app.asar 上现数一遍**（`grep -a -F -c`，与闸门 ⑤ 同一条判据），
#   不去 parse 闸门的 stdout（那正是"拿容易取到的信号当判据"的老病）。
ASAR_OUT="$OUT/win-unpacked/resources/app.asar"
GATE_HIT_ALL=1
IFS='|' read -r -a _VARR <<< "$VSTR"
for _s in "${_VARR[@]}"; do
  [ -n "$_s" ] || continue
  _n="$(grep -a -F -c -- "$_s" "$ASAR_OUT" 2>/dev/null)"
  [ "${_n:-0}" -gt 0 ] || GATE_HIT_ALL=0
done
GATE_STRINGS="${#_VARR[@]}"
GATE_HITS=$([ "$GATE_HIT_ALL" = 1 ] && echo "$GATE_STRINGS" || echo "0")

# ── ⑩ 交付（真构建路径）：归档 → 拷贝 → md5 校验 → manifest
echo "=== ⑩ 交付：归档 → 拷贝 → md5 校验 → manifest（产物旁 <exe>.manifest.txt）==="
# 为什么必须拷出来：产物在 `mktemp -d` 的克隆里，脚本一退出就没了。
# 默认落桌面（OPS §四 的交付纪律：`emdash-<版本>-xiangwo-x64.exe`）；同名且内容不同时**先归档**、绝不静默盖掉。
OUTDIR="${XG_WIN_OUT_DIR:-$HOME/Desktop}"
xg_deliver "$OUTDIR" "$EXE" "端到端" || exit 1
DEST="$OUTDIR/$(basename "$EXE")"

echo "=== ⑪ 交付指纹 ==="
ls -l --time-style=+%m-%d\ %H:%M "$DEST" | sed 's/^/   /'
file -b "$DEST" | cut -c1-90 | sed 's/^/   file: /'
md5sum "$DEST" | sed 's/^/   md5: /'
sha256sum "$DEST" | sed 's/^/   sha256: /'
echo "   包内 better_sqlite3.node: 换后 = $BS_PLAT / $BS_FILE（判据在 ⑨ 由 xg-verify-win-exe.sh 复查）"
echo "=== ✅ 完成：$DEST（拷到 Windows 覆盖安装即可）==="
