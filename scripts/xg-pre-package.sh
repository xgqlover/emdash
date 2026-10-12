#!/bin/bash
# [XG-CUSTOM] 打包前检查：不干净就别打包（防漏改动 / 防打包别人半成品）
# 用法: bash scripts/xg-pre-package.sh [--force]
#       XG_SKIP_NET_CHECK=1 bash scripts/xg-pre-package.sh   # 完全不走网（离线打包）
#       XG_NET_TIMEOUT_S=30  ...                             # 单条网络命令的硬上限（默认 30 秒）
#       XG_NET_ALWAYS_TRY=1  ...                             # ① 失败后仍试 ③（默认跳过第二次等待）
# 退出码: 0 = 可以打包；1 = 不可以（**网络失败不算"不可以"**，只警告）
#
# [XG-CUSTOM 2026-10-12] 稳定性加固：**本脚本里的两条网络命令必须有超时，且失败只警告、不阻断打包**
#   （本地打包不需要远端）。判据：把远端临时指到黑洞 ⇒ ≤30 秒返回且仍能继续打包。
#   · `GIT_TERMINAL_PROMPT=0`：没凭据时直接失败，**不弹交互提示**（卡住的一个来源）；
#   · `GIT_HTTP_LOW_SPEED_LIMIT/TIME`：**在超时之前**先按"低速"掐断（挂住 = 0 字节/秒，
#     10 秒就 abort，比硬 timeout 更早、且能穿透到 libcurl 的连接阶段）；
#   · `timeout -k 2 ${XG_NET_TIMEOUT_S:-30}`：兜底硬上限（`-k 2` = TERM 后再 2 秒 KILL，
#     防"TERM 不理"的进程把 30 秒变成更久）；
#   · `XG_SKIP_NET_CHECK=1`：明口，直接跳过网络步骤（离线打包）。
set -uo pipefail
FORCE="${1:-}"
cd "$(dirname "$0")/.." || exit 1
fail=0
export GIT_TERMINAL_PROMPT=0
export GIT_HTTP_LOW_SPEED_LIMIT="${GIT_HTTP_LOW_SPEED_LIMIT:-1}"
export GIT_HTTP_LOW_SPEED_TIME="${GIT_HTTP_LOW_SPEED_TIME:-10}"
NET_TO="${XG_NET_TIMEOUT_S:-30}"
NET_DEAD=0   # ① 超时/失败 ⇒ ③ 不再等第二次（否则一次离线打包要白等 2×NET_TO）
echo "=== xg 打包前检查 ==="
LOCAL=$(git rev-parse HEAD 2>/dev/null)
if [ "${XG_SKIP_NET_CHECK:-}" = "1" ]; then
  echo "① 远端一致性：**XG_SKIP_NET_CHECK=1 ⇒ 跳过网络检查**（离线打包；后果：只证明本地 HEAD = ${LOCAL:0:9}）"
  REMOTE=""
else
  REMOTE=$(timeout -k 2 "$NET_TO" git ls-remote --heads xgqlover main 2>/dev/null | cut -f1)
fi
echo "① 本地 HEAD = ${LOCAL:0:9}"
echo "  远端 main = ${REMOTE:0:9}"
if [ -z "$REMOTE" ]; then echo "  ⚠️ 读不到远端（网络/代理问题或超时 ${NET_TO}s），**跳过一致性检查**（网络失败不阻断本地打包）"; NET_DEAD=1
elif [ "$LOCAL" != "$REMOTE" ]; then echo "  ❌ 本地与远端不一致 → 先 push（git push xgqlover main）"; fail=1
else echo "  ✅ 一致"; fi
echo "② 未提交改动（忽略 *.bak-*）"
DIRTY=$(git status --porcelain 2>/dev/null | grep -v '\.bak-' || true)
if [ -n "$DIRTY" ]; then
  echo "  ❌ 有未提交改动 —— 打包读的是【已提交】的代码，这些进不去包："
  echo "$DIRTY" | sed 's/^/     /'
  echo "     → 让改动方 commit + push，或由你代为提交"
  fail=1
else echo "  ✅ 干净"; fi
echo "③ 上游落后情况（仅供参考，不影响打包）"
# 同样要超时：这条也走网（2026-10-12 加固，见文件头）。
# `XG_NET_ALWAYS_TRY=1` 可强制在 ① 失败后仍试这一条（要 "早就返回" 就别设，默认跳过）。
if [ "${XG_SKIP_NET_CHECK:-}" = "1" ]; then
  echo "  （XG_SKIP_NET_CHECK=1，跳过）"
elif [ "$NET_DEAD" = "1" ] && [ "${XG_NET_ALWAYS_TRY:-}" != "1" ]; then
  echo "  （① 已经读不到远端 ⇒ 跳过，不再白等一个超时 ${NET_TO}s；要强试加 XG_NET_ALWAYS_TRY=1）"
elif timeout -k 2 "$NET_TO" git fetch origin main -q 2>/dev/null; then
  echo "  落后上游 $(git rev-list --count HEAD..origin/main 2>/dev/null) 个提交"
else
  echo "  （取不到上游 / 超时 ${NET_TO}s，跳过 —— 不影响打包）"
fi
VER=$(node -p "require('./apps/emdash-desktop/package.json').version" 2>/dev/null || echo "?")
echo "④ 当前版本号: $VER"
if [ "${fail}" = "1" ] && [ "${FORCE}" != "--force" ]; then
  echo "=== ❌ 不建议现在打包（API 调用脚本传 --force 可强行继续）==="; exit 1
fi
echo "=== ✅ 可以打包（bash scripts/xg-pre-package.sh 通过）==="
