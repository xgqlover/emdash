#!/bin/bash
# [XG-CUSTOM 2026-10-12] **交付 exe 的验收闸门** —— 唯一目标：让「包打出来了」和「能装能用」不再是同一句话。
#
# 为什么必须存在（2026-10-12 血的教训，两个假通过）：
#   ① 致命：本机（Linux）`pnpm install` 出来的 `better_sqlite3.node` 是 **Linux ELF**，被原样打进 win 包
#      ⇒ Windows 装上启动即 `…better_sqlite3.node is not a valid Win32 application`（Emdash Recovery）。
#      **只看「asar 里有没有这个文件 / 顶层包够不够」永远发现不了** —— 只有问「它是哪个平台的二进制」才行。
#   ② 假缺失：用 `grep`（正则）搜代码串时 `[XG-CUSTOM]` 的 `[ ]` 被当字符类 ⇒ 明明在包里也报「缺失」。
#      ⇒ 本脚本一律 `grep -a -F`（固定串）。**-F 不是可选优化，是判据的一部分。**
#
# 用法:
#   bash scripts/xg-verify-win-exe.sh <exe路径>
#   XG_VERIFY_STRINGS="串A|串B|串C" bash scripts/xg-verify-win-exe.sh <exe>   # 可选的「关键代码串」清单
#   XG_VERIFY_KEEP=1 bash scripts/xg-verify-win-exe.sh <exe>                  # 即使通过也保留解包目录
# 退出码:
#   0 = 验收通过；1 = 验收不过（判据见输出里的 ❌）；2 = 用法/环境错（没有 exe、没有 7z…）
# 副作用: 只在 /tmp 下建 mktemp 目录；**通过则删**，不过则保留（供复核），除非 XG_VERIFY_KEEP=1。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

EXE="${1:-}"
if [ -z "$EXE" ]; then
  echo "用法: bash scripts/xg-verify-win-exe.sh <exe路径>" >&2
  echo "      XG_VERIFY_STRINGS=\"串A|串B\" bash scripts/xg-verify-win-exe.sh <exe>" >&2
  exit 2
fi
[ -f "$EXE" ] || { echo "❌ 没有这个文件: $EXE" >&2; exit 2; }
EXE="$(readlink -f "$EXE")"
PKG_JSON="$ROOT/apps/emdash-desktop/package.json"
[ -f "$PKG_JSON" ] || { echo "❌ 找不到 $PKG_JSON（本脚本要从【仓里】读版本号，不写死）" >&2; exit 2; }
command -v 7z >/dev/null || { echo "❌ PATH 里没有 7z（解 NSIS 要用）" >&2; exit 2; }
# 版本号**从仓里读**：写死的话，下次 bump 之后这条判据就变成"永远通过"或"永远失败"，两者都是假信号。
VER="$(node -p "require('$PKG_JSON').version" 2>/dev/null)"
[ -n "$VER" ] && [ "$VER" != "undefined" ] || { echo "❌ 读不到 $PKG_JSON 的 version" >&2; exit 2; }

WORK="$(mktemp -d /tmp/xg-verify-win-XXXXXX)"
FAIL=0
fail() { echo "   ❌ $*"; FAIL=1; }

echo "== 交付 exe : $EXE"
echo "== 期望版本 : $VER   （来自 apps/emdash-desktop/package.json）"
echo "== 解包目录 : $WORK"

echo "--- ⓪ 指纹 ---"
stat -c '   bytes : %s' "$EXE"
md5sum "$EXE" | sed 's/^/   md5   : /'
sha256sum "$EXE" | sed 's/^/   sha256: /'
FILE_OUT="$(file -b "$EXE")"
echo "   file  : $FILE_OUT"
# 判据：电子签名前的 NSIS 单文件安装包长得就是 `PE32 executable (GUI) … Nullsoft Installer self-extracting archive`。
case "$FILE_OUT" in *PE32*) ;; *) fail "file 不是 PE32（不是 Windows PE）";; esac
case "$FILE_OUT" in *Nullsoft\ Installer*) ;; *) fail "file 里没有 Nullsoft Installer（不是 NSIS 单文件安装包）";; esac

echo "--- ① 解 NSIS 安装器（7z）---"
# NSIS 的安装体在 `$PLUGINSDIR/app-64.7z`（先显式按这个路径找，找不到再 find 兜底 —— 换 electron-builder
# 版本时目录名可能变，兜底是为了"换版本后仍然给出有意义的报错"而不是"假失败"）。
7z x -y -o"$WORK/nsis" "$EXE" >/dev/null 2>&1 || { echo "❌ 7z 解 NSIS 失败（$WORK 已保留）" >&2; exit 1; }
APP7Z="$WORK/nsis/\$PLUGINSDIR/app-64.7z"
[ -f "$APP7Z" ] || APP7Z="$(find "$WORK/nsis" -name 'app-64.7z' 2>/dev/null | head -1)"
if [ -z "${APP7Z:-}" ] || [ ! -f "$APP7Z" ]; then
  echo "❌ 安装器里没有 app-64.7z —— $WORK/nsis 实际内容：" >&2
  find "$WORK/nsis" -maxdepth 2 | head -20 | sed 's/^/     /' >&2
  exit 1
fi
echo "   app-64.7z: ${APP7Z#"$WORK/nsis/"}$(printf ' (%s 字节)' "$(stat -c %s "$APP7Z")")"
7z x -y -o"$WORK/app" "$APP7Z" >/dev/null 2>&1 || { echo "❌ 7z 解 app-64.7z 失败（$WORK 已保留）" >&2; exit 1; }
ASAR="$WORK/app/resources/app.asar"
[ -f "$ASAR" ] || fail "解出来没有 resources/app.asar（app-64.7z 的形状变了？）"

echo "--- ② ★ better_sqlite3.node 的平台（**唯一能防住「ELF 混进 win 包」的判据**）---"
BS="$(find "$WORK/app" -name 'better_sqlite3.node' 2>/dev/null | head -1)"
if [ -z "${BS:-}" ]; then
  fail "包里没有 better_sqlite3.node（数据库层起不来）"
else
  BS_REL="${BS#"$WORK/app/"}"
  BS_FILE="$(file -b "$BS")"
  BS_HEAD="$(head -c 2 "$BS" | od -An -c | tr -d ' \n')"
  echo "   路径 : $BS_REL"
  echo "   file : $BS_FILE"
  echo "   头两字节: $BS_HEAD   （$(stat -c %s "$BS") 字节）"
  # 判据 A：PE32+（Windows x64 的 DLL 就是这个形状；Linux 那份是 `ELF 64-bit LSB shared object`）
  case "$BS_FILE" in *PE32+*) ;; *) fail "better_sqlite3.node 不是 PE32+（Linux ELF 被原样打进包了？）";; esac
  # 判据 B：DOS/PE 魔数 `MZ`（比 `file` 更底层，不依赖 libmagic 的措辞）
  [ "$BS_HEAD" = "MZ" ] || fail "better_sqlite3.node 头两字节不是 MZ（不是 PE 可执行映像）"
  # 判据 C：导出的 ABI 注册符号 `node_register_module_v<ABI>`。
  #   `file` 说 PE32+ **不能**回答"是不是给这个 Electron 编的"（ABI 错的 PE 一样是 PE32+，
  #   真机症状是 `NODE_MODULE_VERSION 137 vs 143` 恢复界面）。ABI 号从**仓里的 electron** 现问，不写死。
  ELEC="$ROOT/node_modules/electron/dist/electron"
  ABI=""
  if [ -x "$ELEC" ]; then
    ABI="$(ELECTRON_RUN_AS_NODE=1 "$ELEC" -p 'process.versions.modules' 2>/dev/null | tr -d '[:space:]')"
  fi
  WANT_SYM="node_register_module_v${ABI:-?}"
  HAZ_SYM="$(grep -a -o 'node_register_module_v[0-9]*' "$BS" 2>/dev/null | sort -u | tr '\n' ' ')"
  if [ -n "$ABI" ]; then
    echo "   期望 ABI: $ABI（$ROOT/node_modules/electron → process.versions.modules）"
    echo "   实际导出: ${HAZ_SYM:-（一个都没找到）}"
    if grep -a -q -F -- "$WANT_SYM" "$BS"; then
      echo "   ✅ 导出里含 $WANT_SYM（ABI 对得上）"
    else
      fail "导出里没有 $WANT_SYM ⇒ 这份原生件不是给当前 Electron($ABI) 编的"
    fi
  else
    echo "   ⚠️ 问不到 electron 的 ABI（$ELEC 不可执行）⇒ 只列它导出了什么，**不判死**：${HAZ_SYM:-（无）}"
  fi
fi

echo "--- ③ 全部 .node 清单（**只列平台，不判死**）---"
# 为什么不判死：pnpm 的树里本来就同时躺着别的平台的预编译件，它们是**死重量**，Windows 不会 require：
#   · `node-pty/build/Release/pty.node`（ELF）—— node-pty 是 `try { require(./build/Release/pty.node) }
#     catch { require(./prebuilds/<platform>-<arch>/pty.node) }` **逐目录回退** ⇒ win32 侧实际用的是
#     `prebuilds/win32-x64/pty.node`（下面清单里能看到它在，且是 PE32+）。
#   · `@parcel/watcher-linux-*` / `@rollup/rollup-linux-*` / `node-pty/prebuilds/darwin-*` —— 运行期按平台选。
#   · `ssh2` 的 `sshcrypto.node`（ELF）—— 源码 `try { require(…) } catch {}` ⇒ 缺了退回纯 JS。
#   · `@rollup/rollup-win32-*` —— **构建期**工具，运行时不加载。
# 真要"零非 PE"，得在 electron-builder.config.ts 的 files 里排除（那是体积优化，不是今天的病因）。
if command -v file >/dev/null; then
  while IFS= read -r f; do
    printf '   %-100s %s\n' "${f#"$WORK/app/"}" "$(file -b "$f" | cut -c1-70)"
  done < <(find "$WORK/app" -name '*.node' 2>/dev/null | sort)
else
  echo "   （没有 file 命令，跳过）"
fi

echo "--- ④ 版本串必须在 app.asar 里命中（**以包内版本为准**；仓里版本只作提示）---"
if [ ! -f "$ASAR" ]; then
  fail "没有 app.asar，没法验版本串"
else
  # 🔴 [XG-CUSTOM 2026-10-12] **版本判据以「包内」为准**：
  #   本脚本原来拿仓里 `apps/emdash-desktop/package.json` 当期望值并**判死** ⇒ 多会话共用工作区时，
  #   **构建期间**另一条线 bump 版本（今天实测：包是 1.2.41、仓里已是 1.2.42）⇒ **"包是好的却验收不过"（假失败）**。
  #   ⇒ 先读出 asar 内嵌 package.json 的 version，以它为准；仓里版本不一致只**警告**。
  #   真正的"压根没打进版本"仍然判死（那是结构性问题）。
  ASAR_VER="$(cd "$ROOT" && node -e '
    try {
      const a = require("@electron/asar");
      const buf = a.extractFile(process.argv[1], "package.json");
      process.stdout.write(String(JSON.parse(buf.toString("utf-8")).version || ""));
    } catch (e) { process.stdout.write(""); }
  ' "$ASAR" 2>/dev/null)"
  EXPECT_VER="${ASAR_VER:-$VER}"
  # `-a`：asar 是二进制；`-F`：固定串（这个项目的代码串里常带 `[XG-CUSTOM]`，正则下会变成字符类 ⇒ 假缺失）。
  n="$(grep -a -F -c -- "$EXPECT_VER" "$ASAR" 2>/dev/null)"
  if [ "${n:-0}" -gt 0 ]; then
    echo "   ✅ 命中 ×$n : $EXPECT_VER"
  else
    fail "app.asar 里搜不到版本串 $EXPECT_VER（打进包的 app 不是这个版本？）"
  fi
  # 被验的 exe 文件名本身带不带版本（只**提示**，不判死）—— 2026-10-12 的坑是脚本按不带版本的名字找产物。
  case "$(basename "$EXE")" in *"$EXPECT_VER"*) ;; *) echo "   ⚠️ exe 文件名里没有版本串 $EXPECT_VER（交付命名纪律：`emdash-<版本>-x64.exe`）";; esac
  if [ -n "$ASAR_VER" ]; then
    if [ "$ASAR_VER" = "$VER" ]; then
      echo "   ✅ asar 内 package.json.version = $ASAR_VER（与仓里一致）"
    else
      echo "   ⚠️ 包内版本 $ASAR_VER ≠ 仓里 $VER —— 多半是**构建期间有人 bump**（多会话常态）⇒ **以包内为准，不判死**"
    fi
  else
    echo "   （没解析出 asar 内 package.json，跳过字段比对；上面的 grep 命中已足够）"
  fi
fi

echo "--- ⑤ 关键代码串（可选，XG_VERIFY_STRINGS=\"a|b|c\"）---"
if [ -z "${XG_VERIFY_STRINGS:-}" ]; then
  echo "   （未指定，跳过）"
else
  if [ ! -f "$ASAR" ]; then
    fail "没有 app.asar，没法搜代码串"
  else
    # 按 `|` 切开逐个搜。**必须 grep -a -F**（见文件头 ② 与上面的注释）。
    # 🔴 [XG-CUSTOM 2026-10-12] `read` 的**最后一行**：`printf '%s'` **不带结尾换行** ⇒
    #   最后一行 `read` 返回**非 0**（虽然 s 已被赋值）⇒ 循环体**不执行**：
    #     单串时整段静默跳过、多串时**最后一个串从不被验** ⇒ 传一个根本不存在的串仍然 ✅ / exit 0 = **假通过**
    #   （2026-10-12 实测；同族的"空 ≠ 失败/假通过"）。⇒ 用 `|| [ -n "$s" ]` 收下这一行。
    while IFS= read -r s || [ -n "$s" ]; do
      [ -n "$s" ] || continue
      n="$(grep -a -F -c -- "$s" "$ASAR" 2>/dev/null)"
      if [ "${n:-0}" -gt 0 ]; then echo "   ✅ 命中 ×$n : $s"; else fail "缺失    : $s"; fi
    done < <(printf '%s\n' "$XG_VERIFY_STRINGS" | tr '|' '\n')
  fi
fi

if [ "$FAIL" = "0" ]; then
  echo "== 结论: ✅ 验收通过（${EXPECT_VER:-$VER} / better_sqlite3.node = PE32+ / 版本串命中）"
  [ "${XG_VERIFY_KEEP:-}" = "1" ] || { rm -rf "$WORK"; WORK="(已删；要复核加 XG_VERIFY_KEEP=1)"; }
  echo "== 解包目录: $WORK"
else
  echo "== 结论: ❌ 验收不过（见上面 ❌）"
  echo "== 解包目录保留可复核: $WORK"
fi
exit "$FAIL"
