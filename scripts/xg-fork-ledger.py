#!/usr/bin/env python3
"""[XG 2026-11-20] emdash 定制台账（生成 + 校验）。

上游一更新，我们改过的地方可能被覆盖。判据不是"看 git diff"（会被覆盖掉），
而是**每个定制文件里必须带 `[XG` 标记**；台账由标记生成，`--check` 用它验退。

用法：
  python3 scripts/xg-fork-ledger.py --write    # 重新生成台账（CUSTOMIZATIONS-LEDGER.md + .json）
  python3 scripts/xg-fork-ledger.py --check    # 校验：文件丢了/标记没了 ⇒ 退出码 1
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN = ["apps", "packages"]
EXTS = (".ts", ".tsx", ".js", ".mjs", ".css", ".scss", ".json", ".md", ".html", ".sh")
SKIP = ("node_modules", "/dist/", "/out/", ".git/")
MARK = re.compile(r"\[XG[- ]|XG-CUSTOM")

LEDGER = os.path.join(ROOT, "CUSTOMIZATIONS-LEDGER.md")
JSON = os.path.join(ROOT, "CUSTOMIZATIONS-LEDGER.json")


def scan():
    found = []
    for top in SCAN:
        for dirpath, dirnames, files in os.walk(os.path.join(ROOT, top)):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "out")]
            for fn in files:
                if not fn.endswith(EXTS):
                    continue
                p = os.path.join(dirpath, fn)
                rel = os.path.relpath(p, ROOT)
                if any(s in "/" + rel for s in SKIP):
                    continue
                try:
                    for i, line in enumerate(open(p, encoding="utf-8", errors="ignore"), 1):
                        if MARK.search(line):
                            found.append({"file": rel, "line": i, "mark": line.strip()[:120]})
                            break
                except Exception:
                    pass
    return found


def write(rows):
    by_area = {}
    for r in rows:
        area = r["file"].split("/")[1] if "/" in r["file"] else "(root)"
        by_area.setdefault(area, []).append(r)
    out = ["# emdash 定制台账（由 `[XG` 标记自动生成，别手改）", "",
           "> 生成：`python3 scripts/xg-fork-ledger.py --write`｜校验：`--check`",
           "> 判据：**每个定制文件里必须有 `[XG` 标记**；上游覆盖 → `--check` 立即报红。", "",
           "合计 **%d** 个定制文件。" % len(rows), ""]
    for area in sorted(by_area):
        out.append("## %s（%d）" % (area, len(by_area[area])))
        out.append("")
        out.append("| 文件 | 行 | 标记 |")
        out.append("|---|---|---|")
        for r in sorted(by_area[area], key=lambda x: x["file"]):
            out.append("| `%s` | %d | %s |" % (r["file"], r["line"], r["mark"].replace("|", "\\|")))
        out.append("")
    open(LEDGER, "w", encoding="utf-8").write("\n".join(out) + "\n")
    json.dump({"generated": "2026-11-20", "count": len(rows), "files": rows},
              open(JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def check():
    if not os.path.isfile(JSON):
        print("❌ 台账不存在，先跑 --write"); return 1
    base = json.load(open(JSON, encoding="utf-8"))["files"]
    now = {r["file"] for r in scan()}
    missing = [r["file"] for r in base if r["file"] not in now]
    if missing:
        print("❌ 上游更新把它们冲掉了（%d）：" % len(missing))
        for f in missing[:20]:
            print("  -", f)
        return 1
    print("✅ 台账 %d 个文件全部还在、标记都在" % len(base))
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    rows = scan()
    write(rows)
    print("已生成台账：%d 个定制文件 → %s" % (len(rows), os.path.basename(LEDGER)))
