"""Turns results.json into plots (PNG) and a Markdown table. Pure presentation - no numbers are invented here."""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt   # noqa: E402

COLORS = {"ours": "#7c5cff", "pdf2docx": "#ff6a4d", "word_reflow": "#22b8cf"}


def _grouped(ax, rows, getter, title, ylabel, docs, tools):
    n = len(tools)
    w = 0.8 / max(1, n)
    for i, t in enumerate(tools):
        vals = []
        for d in docs:
            r = next((x for x in rows if x["doc"] == d and x["tool"] == t), None)
            v = getter(r) if r and r.get("ok") else None
            vals.append(v if v is not None else 0)
        bars = ax.bar([k + i * w for k in range(len(docs))], vals, w, label=t, color=COLORS.get(t))
        for b, v, d in zip(bars, vals, docs):
            r = next((x for x in rows if x["doc"] == d and x["tool"] == t), None)
            if not (r and r.get("ok") and getter(r) is not None):
                ax.text(b.get_x() + b.get_width() / 2, 0, "n/a", ha="center", va="bottom", fontsize=7, rotation=90)
    ax.set_xticks([k + w * (n - 1) / 2 for k in range(len(docs))])
    ax.set_xticklabels(docs, rotation=20, ha="right", fontsize=8)
    ax.set_title(title, fontsize=11)
    ax.set_ylabel(ylabel)
    ax.grid(axis="y", alpha=.25)


def make_plots(json_path, out_dir):
    data = json.load(open(json_path, encoding="utf-8"))
    rows = data["results"]
    docs = list(dict.fromkeys(r["doc"] for r in rows))
    tools = list(dict.fromkeys(r["tool"] for r in rows))
    fig, axes = plt.subplots(2, 3, figsize=(17, 8.5))
    _grouped(axes[0][0], rows, lambda r: (r.get("text") or {}).get("wer"), "Word error rate (lower is better)", "WER", docs, tools)
    _grouped(axes[0][1], rows, lambda r: (r.get("text") or {}).get("cer"), "Character error rate (lower is better)", "CER", docs, tools)
    _grouped(axes[0][2], rows, lambda r: (r.get("layout") or {}).get("mean_err_pct_width"), "Mean word position error (lower is better)", "% of page width", docs, tools)
    _grouped(axes[1][0], rows, lambda r: (r.get("layout") or {}).get("page_ratio"), "Page-count ratio (1.0 = same as PDF)", "Word pages / PDF pages", docs, tools)
    _grouped(axes[1][1], rows, lambda r: r.get("seconds"), "Conversion time", "seconds", docs, tools)
    _grouped(axes[1][2], rows, lambda r: r.get("peak_mb"), "Peak memory (process tree)", "MB", docs, tools)
    h, l = axes[0][0].get_legend_handles_labels()
    fig.legend(h, l, loc="upper center", ncol=len(tools))
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(os.path.join(out_dir, "comparison.png"), dpi=130)
    plt.close(fig)
    # table-F1 plot
    trows = [r for r in rows if r.get("table")]
    if trows:
        fig, ax = plt.subplots(figsize=(5, 3.5))
        _grouped(ax, rows, lambda r: (r.get("table") or {}).get("f1"), "Table cell F1 (higher is better)", "F1", ["tables"], tools)
        fig.tight_layout(); fig.savefig(os.path.join(out_dir, "tables.png"), dpi=130); plt.close(fig)
    # markdown
    env = data["environment"]
    L = ["# Benchmark results (measured)", "", "Environment: " + ", ".join("%s=%s" % kv for kv in env.items()), "",
         "| document | tool | ok | pages | WER | CER | table F1 | layout err % width | page ratio | seconds | peak MB |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    f = lambda v: "-" if v is None else v
    for r in rows:
        t, tb, ly = r.get("text") or {}, r.get("table") or {}, r.get("layout") or {}
        L.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (r["doc"], r["tool"], "yes" if r["ok"] else "FAILED", r["pages"], f(t.get("wer")), f(t.get("cer")),
                 f(tb.get("f1")), f(ly.get("mean_err_pct_width")), f(ly.get("page_ratio")), f(r.get("seconds")), f(r.get("peak_mb"))))
    open(os.path.join(out_dir, "results.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    import sys
    make_plots(sys.argv[1], os.path.dirname(sys.argv[1]))
