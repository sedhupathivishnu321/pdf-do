"""word_reflow_test.py IN.pdf OUT.docx - convert a PDF with Microsoft Word's own PDF reflow (COM), with a watchdog."""
import os
import sys
import threading
import time

import pythoncom
import win32com.client

src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
t0 = time.time()
w = win32com.client.DispatchEx("Word.Application")
w.Visible = True
w.DisplayAlerts = 0                       # wdAlertsNone: suppress the "convert PDF" prompt
try:
    w.Options.ConfirmConversions = False
except Exception:
    pass
d = w.Documents.Open(FileName=src, ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False, Visible=False,
                     NoEncodingDialog=True)
print("opened in %.1fs, pages %s" % (time.time() - t0, d.ComputeStatistics(2)))
d.SaveAs2(out, 16)                        # wdFormatXMLDocument
d.Close(False)
w.Quit()
print("saved", out, os.path.getsize(out))
