"""word_render.py IN.docx OUT.pdf  - render a .docx with Microsoft Word (COM) and print the page count."""
import os
import sys

import win32com.client

w = win32com.client.DispatchEx("Word.Application")
w.Visible = False
w.DisplayAlerts = 0
d = w.Documents.Open(os.path.abspath(sys.argv[1]), False, True)
d.ExportAsFixedFormat(os.path.abspath(sys.argv[2]), 17)
print("pages", d.ComputeStatistics(2))
d.Close(False)
w.Quit()
