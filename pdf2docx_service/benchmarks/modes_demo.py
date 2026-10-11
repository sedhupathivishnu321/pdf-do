"""modes_demo.py IN.pdf OUT_DIR - converts a PDF in both modes, prints the measured quality report, renders each with Word if present."""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from engine import ConversionOptions, convert_pdf  # noqa: E402

pdf, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for m in ("editable", "layout"):
    path = os.path.join(out, "mode_%s.docx" % m)
    r = convert_pdf(pdf, path, ConversionOptions(mode=m))
    print(m, "seconds", r.seconds, "integrity", r.quality["integrity"], "completeness", r.quality["text_completeness"], r.quality["notes"])
    try:
        subprocess.run([sys.executable, os.path.join(ROOT, "benchmarks", "word_render.py"), path, os.path.join(out, "mode_%s.pdf" % m)], check=False, timeout=180)
    except Exception as e:  # noqa: BLE001
        print("render skipped:", e)
