"""corpus_run.py [mode ...]  - convert every PDF listed in corpus.txt, render the .docx back with Word, and report per document:
page ratio, share of source words present, median / 95th-percentile word position error, and conversion time.
Output: benchmarks/results/corpus_<mode>.json and a printed table. Everything is measured here; nothing is hard-coded."""
import json
import os
import statistics as st
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import pymupdf as fitz  # noqa: E402
from engine import ConversionOptions, convert_pdf  # noqa: E402

modes = sys.argv[1:] or ["layout"]
corpus = [l.strip() for l in open(os.path.join(ROOT, "benchmarks", "corpus.txt"), encoding="utf-8") if l.strip()]
work = os.path.join(ROOT, "benchmarks", "_corpus_tmp")
os.makedirs(work, exist_ok=True)
res_dir = os.path.join(ROOT, "benchmarks", "results")
os.makedirs(res_dir, exist_ok=True)


def measure(src, rendered):
    a, b = fitz.open(src), fitz.open(rendered)
    errs, tot, miss = [], 0, 0
    for i in range(min(a.page_count, b.page_count)):
        pool = {}
        for x in b[i].get_text("words"):
            pool.setdefault(x[4], []).append(x)
        W = a[i].rect.width
        for w in a[i].get_text("words"):
            tot += 1
            c = pool.get(w[4])
            if not c:
                miss += 1
                continue
            m = min(c, key=lambda q: abs(q[0] - w[0]) + abs(q[1] - w[1]))
            errs.append((((m[0] - w[0]) ** 2 + (m[1] - w[1]) ** 2) ** 0.5) / W)
    errs.sort()
    return {"words": tot, "present": round(1 - miss / tot, 3) if tot else None,
            "median_pct": round(100 * st.median(errs), 2) if errs else None,
            "p95_pct": round(100 * errs[int(0.95 * (len(errs) - 1))], 2) if errs else None,
            "within2": round(sum(e <= 0.02 for e in errs) / tot, 3) if tot else None}


for mode in modes:
    rows = []
    for k, src in enumerate(corpus):
        name = "d%02d" % k
        out = os.path.join(work, "%s_%s.docx" % (name, mode))
        pdf = os.path.join(work, "%s_%s.pdf" % (name, mode))
        r = {"doc": os.path.basename(src)[:44], "mode": mode, "src_pages": fitz.open(src).page_count}
        try:
            t0 = time.time()
            rep = convert_pdf(src, out, ConversionOptions(mode=mode))
            r["convert_s"] = round(time.time() - t0, 1)
            r["ocr_pages"] = rep.ocr_pages
            p = subprocess.run([sys.executable, os.path.join(ROOT, "benchmarks", "word_render.py"), out, pdf], capture_output=True, text=True, timeout=240)
            if os.path.exists(pdf):
                r["docx_pages"] = fitz.open(pdf).page_count
                r.update(measure(src, pdf))
            else:
                r["error"] = "word render failed: " + (p.stderr or "")[-120:]
        except Exception as e:  # noqa: BLE001
            r["error"] = str(e)[:150]
        rows.append(r)
        print(r, flush=True)
        subprocess.run(["taskkill", "/F", "/IM", "WINWORD.EXE"], capture_output=True)
    json.dump(rows, open(os.path.join(res_dir, "corpus_%s.json" % mode), "w"), indent=1)
    ok = [x for x in rows if x.get("docx_pages")]
    print("MODE", mode, "page count preserved: %d/%d" % (sum(x["docx_pages"] == x["src_pages"] for x in ok), len(rows)),
          "median of medians %.2f%%" % st.median([x["median_pct"] for x in ok if x.get("median_pct") is not None] or [0]))
