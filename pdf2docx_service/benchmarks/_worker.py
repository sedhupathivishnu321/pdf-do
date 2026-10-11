"""Runs one converter on one file in a fresh process (so time and memory are attributable). Usage: _worker.py TOOL IN.pdf OUT.docx"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
tool, pdf, out = sys.argv[1:4]

if tool == "ours":
    from engine import ConversionOptions, convert_pdf
    convert_pdf(pdf, out, ConversionOptions())
elif tool == "pdf2docx":
    from pdf2docx import Converter
    cv = Converter(pdf)
    cv.convert(out)
    cv.close()
elif tool == "word_reflow":
    # Microsoft Word's own PDF reflow (File > Open on a PDF). Available only where Word is installed.
    import win32com.client
    w = win32com.client.DispatchEx("Word.Application")
    w.Visible = False
    w.DisplayAlerts = 0
    d = w.Documents.Open(os.path.abspath(pdf), False, True, False, "", "", False, "", "", 0, 0, False)  # ConfirmConversions=False
    d.SaveAs2(os.path.abspath(out), 16)
    d.Close(False)
    w.Quit()
else:
    raise SystemExit("unknown tool " + tool)
