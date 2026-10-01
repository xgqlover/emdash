#!/bin/bash
# [XG-CUSTOM] 打包前检查：不干净就别打包（防漏改动 / 防打包别人半成品）
# 用法: bash scripts/xg-pre-package.sh [--force]
# 退出码: 0 = 可以打包；1 = 不可以
set -uo pipefail
FORCE="${1:-}"
cd "$(dirname "$0")/.." || exit 1
fail=0
echo "=== xg 打包前检查 ==="
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git ls-remote --heads xgqlover main 2>/dev/null | cut -f1)
echo "① 本地 HEAD = ${LOCAL:0:9}"
echo "  远端 main = ${REMOTE:0:9}"
if [ -z "$REMOTE" ]; then echo "  ⚠️ 读不到远端（网络/代理问题），跳过一致性检查"; 
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
git fetch origin main -q 2>/dev/null && echo "  落后上游 $(git rev-list --count HEAD..origin/main 2>/dev/null) 个提交" || echo "  （取不到上游，跳过）"
VER=$(node -p "require('./apps/emdash-desktop/package.json').version" 2>/dev/null || echo "?")
echo "④ 当前版本号: $VER"
if [ "${fail}" = "1" ] && [ "${FORCE}" != "--force" ]; then
  echo "=== ❌ 不建议现在打包（API 调用脚本传 --force 可强行继续）==="; exit 1
fi
echo "=== ✅ 可以打包（bash scripts/xg-pre-package.sh 通过）==="
