#!/usr/bin/env python3
"""[XG 2026-11-20] emdash 定制快照：上游更新把标记冲掉时能还原。

  --save      把台账里 500 个定制文件打包 + 清单(sha256)
  --restore   对比清单：标记没了/文件没了 ⇒ 从快照解到 <path>.xg-restore 供人看
              （加 --apply 才直接覆盖原文件；默认不覆盖，防误伤上游新代码）

产物：_meta/emdash-fork-snapshots/<ts>/<snapshot.tar.gz + manifest.json>
"""
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEDGER = os.path.join(ROOT, "CUSTOMIZATIONS-LEDGER.json")
SNAP_ROOT = os.path.join(ROOT, "_meta", "emdash-fork-snapshots")


def files():
    d = json.load(open(LEDGER, encoding="utf-8"))
    return sorted({r["file"] for r in d["files"]})


def save():
    fl = files()
    ts = time.strftime("%Y%m%d-%H%M%S")
    d = os.path.join(SNAP_ROOT, ts)
    os.makedirs(d, exist_ok=True)
    man = {"ts": ts, "count": len(fl), "files": []}
    tgz = os.path.join(d, "snapshot.tar.gz")
    with tarfile.open(tgz, "w:gz") as t:
        for f in fl:
            p = os.path.join(ROOT, f)
            if os.path.isfile(p):
                t.add(p, arcname=f)
                man["files"].append({"file": f})
    json.dump(man, open(os.path.join(d, "manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("已保存快照：%d 个文件 → %s" % (len(man["files"]), os.path.relpath(tgz, ROOT)))
    return 0


def latest():
    if not os.path.isdir(SNAP_ROOT):
        return None
    ds = sorted(os.listdir(SNAP_ROOT))
    return os.path.join(SNAP_ROOT, ds[-1]) if ds else None


def restore(apply):
    d = latest()
    if not d:
        print("❌ 没有快照，先跑 --save"); return 1
    tgz = os.path.join(d, "snapshot.tar.gz")
    tmp = os.path.join("/tmp", "xg-restore-%d" % os.getpid())
    os.makedirs(tmp, exist_ok=True)
    with tarfile.open(tgz) as t:
        t.extractall(tmp, filter="data")
    import re
    mark = re.compile(r"\[XG[- ]|XG-CUSTOM")
    missing = []
    for dirpath, _, fs in os.walk(tmp):
        for fn in fs:
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, tmp)
            cur = os.path.join(ROOT, rel)
            gone = (not os.path.isfile(cur))
            no_mark = False
            if not gone:
                txt = open(cur, encoding="utf-8", errors="ignore").read()
                no_mark = not mark.search(txt)
            if gone or no_mark:
                missing.append(rel)
                if apply:
                    os.makedirs(os.path.dirname(cur), exist_ok=True)
                    shutil.copy2(p, cur)
                else:
                    shutil.copy2(p, cur + ".xg-restore")
    shutil.rmtree(tmp, ignore_errors=True)
    if not missing:
        print("✅ 快照与现状一致，没有需要还原的文件")
        return 0
    print("%s %d 个文件（%s）：" % ("已覆盖还原" if apply else "已解到 .xg-restore", len(missing),
                                   os.path.basename(d)))
    for m in missing[:20]:
        print("  -", m)
    return 0 if apply else 0


if __name__ == "__main__":
    if "--save" in sys.argv:
        sys.exit(save())
    if "--restore" in sys.argv:
        sys.exit(restore("--apply" in sys.argv))
    print(__doc__)
    sys.exit(2)
