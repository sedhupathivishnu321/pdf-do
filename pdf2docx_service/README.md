# PDF → DOCX service (PDF Do)

A modular, local-only PDF-to-Word converter: PyMuPDF analysis → optional Tesseract OCR → geometric layout analysis → python-docx reconstruction, with a FastAPI backend and a small web UI. It is independent of the PDF Do desktop app (which has its own in-browser exporter) and can be used as a library, a CLI or a web service.

> **Status: research-grade, not perfect.** Layout preservation is good on simple, two-column and bordered-table pages and approximate elsewhere. See *Limitations*. All numbers in this README come from `benchmarks/results/` and were produced by the scripts in this folder on the hardware listed there.

## Install

```powershell
cd pdf2docx_service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
# OCR (optional but needed for scanned PDFs): install Tesseract 5 + the 'eng' (and 'osd') traineddata
#   Windows: https://github.com/UB-Mannheim/tesseract/wiki   Linux: apt install tesseract-ocr
#   if it is not on PATH:  set PDF2DOCX_TESSERACT=C:\Program Files\Tesseract-OCR\tesseract.exe
```

Python 3.10+. Tested with the versions recorded in `benchmarks/results/results.json` (`environment`).

## Use

```powershell
.venv\Scripts\python cli.py input.pdf output.docx --ocr auto          # CLI, prints a JSON report
.venv\Scripts\python -m uvicorn app.main:app --port 8000               # web UI at http://127.0.0.1:8000
.venv\Scripts\python -m pytest -q tests                                # 22 automated tests
.venv\Scripts\python benchmarks\run_benchmark.py [--extra my_pdfs]     # reproduces the benchmark + plots
```

Library:

```python
from engine import convert_pdf, ConversionOptions
report = convert_pdf("in.pdf", "out.docx", ConversionOptions(ocr="auto", ocr_lang="eng"))
```

## Architecture (`engine/`)

| stage | module | what it does |
|---|---|---|
| 1 analysis | `analysis.py` | `page.get_text("dict")` → spans with font, size, bold/italic (flags + name heuristics), colour, origin, bbox; hyperlinks (`get_links`); raster images (`get_image_info`, CMYK→RGB); vector figures (clustering of `get_drawings` rectangles, rendered at 220 dpi); tables (`find_tables`, with a text-alignment fallback accepted only when the result is compact and mostly short cells); duplicate-layer removal; **splitting of PyMuPDF "lines" at wide gaps** so column gutters are visible; page classification native / scanned / mixed (selectable characters vs. image coverage) |
| 2 OCR | `ocr.py` | 300 dpi render → Tesseract OSD orientation fix → fastNlMeans denoise → skew estimation (projection-profile variance over ±8°) and rotation → local-contrast normalisation + adaptive Gaussian threshold → `image_to_data` words with confidence (words below `OCR_MIN_CONF` dropped) → lines mapped back to PDF points. Per-page mean confidence is reported |
| 3 layout | `layout.py` | column detection by a coverage profile over line extents (a gutter is a ≥10 pt stripe crossed by ≤6 % of lines); page cut into **bands** (full-width title / caption lines separate multi-column runs); reading order = band → column → y; paragraph grouping from vertical gap, baseline pitch, style, bullet markers and first-line indent; headings from size relative to the body font (modal size) and boldness; lists from marker regexes; alignment (left / centre / right / justified) from line-end statistics; drop-cap folding; math regions (math fonts + Unicode math ranges, grown over neighbouring fragments and equation numbers) rendered as 300 dpi images; header/footer detection by recurrence across pages and bare page numbers |
| 4 DOCX | `docx_builder.py` | python-docx: one section per band (`w:cols` with unequal widths for columns), exact line pitch and spacing-before so vertical rhythm follows the PDF, runs with font/size/bold/italic/colour, hyperlinks (`w:hyperlink` via `relate_to`), real Word tables, inline images, outline levels for headings, page size/margins per page, headers/footers. Custom XML only for columns, section type, hyperlinks and outline level |
| orchestration | `pipeline.py` | per-page decisions, progress callbacks, report (pages by source, tables, images, figures, math regions, OCR confidence, warnings, seconds, peak Python memory) |

Configuration lives in `config.py` (every value overridable with `PDF2DOCX_*` environment variables): upload limit (50 MB), page limit (200), concurrent jobs (2), job timeout, result TTL, OCR dpi/language/confidence floor, column/paragraph thresholds.

## Web service & security

`app/main.py` (FastAPI) – `POST /api/convert` (multipart; options `ocr`, `lang`, `pages`, `math_as_image`, `tables`), `GET /api/jobs/{id}` (progress), `GET …/download`, `GET …/preview/{page}?kind=source|layout`, `DELETE /api/jobs/{id}`, `GET /api/health`.

* Upload validation: `.pdf` extension, `%PDF-` magic bytes, streaming size limit, must open in PyMuPDF, encrypted files rejected, page limit.
* Files are stored as `_tmp/<random 32-hex>/in.pdf|out.docx`; client file names are never used on disk (only sanitised for the download name); job ids are validated against a strict regex (no path traversal).
* Bounded concurrency + per-job timeout; results and uploads are deleted after `RESULT_TTL_S` (default 15 min), on `DELETE`, and orphan folders are swept every 30 s.
* No document content is logged; no network access is used. Bind to `127.0.0.1` (default); put it behind your own authentication/TLS before exposing it. Not hardened against malicious PDFs beyond PyMuPDF's own robustness – run it as an unprivileged user (ideally in a container) if you accept untrusted files.

## Evaluation

`testdata.py` generates **synthetic, copyright-free** documents with known ground truth (single-column text, two-column, bordered table, scanned = rasterised at 200 dpi with 1.2° skew + blur + noise + uneven lighting, mixed). `benchmarks/run_benchmark.py` runs each converter in a fresh subprocess, so time and peak RSS (sampled every 20 ms, process tree) are attributable, and computes:

* **WER / CER** (jiwer) of the .docx text vs. ground truth – reading order counts.
* **Table F1** – exact cell match (row, column, text) against the generated table.
* **Layout fidelity** (needs Microsoft Word + `pywin32`): Word renders the .docx back to PDF; each word of the original is matched to the nearest same word in the render; reported are page-count ratio, mean position error (% page width) and share of words within 2 % of their original position.
* **Time and memory.**

Compared tools: this system (`ours`), the open-source `pdf2docx` library, and Microsoft Word's own PDF reflow (only where Word is installed). **Add your own PDFs with `--extra DIR`** – those are scored on time, memory and layout only (no ground truth). Public datasets you can legally download for further evaluation: PubLayNet / DocLayNet (layout), PubTabNet / FinTabNet (tables), FUNSD / SROIE (scanned forms, OCR) – this repository does not redistribute them.

Results, plots (`comparison.png`, `tables.png`) and the full environment record (CPU, RAM, library versions, Tesseract version) are written to `benchmarks/results/`. **Read those files, not this README, for numbers.**

## Conversion modes and quality report

`mode=editable` (default) rebuilds Word paragraphs, columns (`w:cols` + column breaks), native tables and inline pictures. `mode=layout` places every line (positioned frames), picture (page-anchored floating pictures) and table (floating table) at its original absolute position. Neither mode is an image-only DOCX; equations and figures are pictures in both.

Each conversion returns a measured `quality` block: package integrity, `text_completeness` (characters of the PDF text layer present as editable text in the .docx), per-page raster-region counts, and notes listing what became pictures. It is a self-check, **not** a rendered comparison (that needs Word/LibreOffice - see `benchmarks/word_render.py`, which uses Word via COM when installed).

Observed on one real 8-page two-column paper (rendered back by Microsoft Word, Windows): editable mode = 10 pages (a line or two spills on three pages), layout mode = 8 pages with equations, tables, figures and text at their original positions on the pages inspected (pages 2, 3 and 6). One stray fragment of an inline equation remained on page 2 in layout mode. These are single-document observations, not benchmark statistics.

## Default mode and the 14-document corpus test

**Layout-preserved is the default** (`mode=layout`): one Word section per PDF page with the same page size; every text line is an editable, page-anchored frame at its original position, fitted to its original width; raster images are anchored pictures; all vector artwork (table rules, borders, cell shading, diagram strokes, chart axes) is rendered **without text** as one background picture behind the text; single-line equations are editable Word equations, stacked ones pictures. No Word tables are built in this mode (they were the main source of misplaced columns and lost pictures on unusual PDFs). Because positions are absolute, the page count cannot grow from reflow and there is no added whitespace.

`mode=editable` (reflowing paragraphs, columns, real tables) is kept as a best-effort option: it is not general.

Measured on 14 real PDFs from this PC (`benchmarks/corpus.txt`: journal papers from Acrobat/pdfTeX, a Matplotlib figure, a landscape LaTeX sheet, an invoice with product pictures, web-page prints, email prints, a scanned print-to-PDF; 1-14 pages), each converted, rendered back by Microsoft Word and compared with `benchmarks/corpus_run.py`:

| mode | page count preserved | median of per-document median word position error |
|---|---|---|
| layout (default) | **14 / 14** | **0.23 %** of page width |
| editable | 4 / 14 | 8.75 % |

Per-document numbers: `benchmarks/results/corpus_layout.json`, `corpus_editable.json`. Weak spots seen in layout mode: lines with inline math and large web-font headings drift by a few points (95th-percentile error up to ~12 % on one email print); text inside raster images is not recoverable unless OCR is used; the scanned file could not be scored (no source text layer). The corpus is the author's own documents, not a public benchmark.

## LaTeX / TeX-produced PDFs

Supported as a first-class input (the 8-page IEEE-style paper used throughout development is a LaTeX PDF with Nimbus + Computer Modern fonts). Handled specifically: TeX font names mapped to Word fonts (Nimbus Roman -> Times New Roman, CM math -> Cambria Math), ligatures (fi fl ffi ...) split back into letters, line-end hyphenation re-joined, drop caps merged, booktabs (rules-only) tables, two-column pages as real Word columns, hyperref links kept, equation numbers kept. **Single-line equations** (no fractions / big-operator limits) become **editable Word equations (OMML)** with superscripts and subscripts; **stacked equations** (fractions, sums with limits, matrices) stay sharp 300 dpi pictures because their 2-D structure cannot be recovered reliably from glyph positions. On the test paper 7 equations became editable Word equations and 14 stacked ones stayed pictures (see the `quality.notes` of each conversion). Disable with `PDF2DOCX_OMML=0`.

## Comparison with the iLovePDF desktop app (same input, measured)

Reference output: the iLovePDF Windows app (Microsoft Store, v2.3.0) converting the same 8-page two-column LaTeX paper; its .docx was rendered by Microsoft Word and compared word-by-word with the source PDF (each source word matched to the nearest identical word in the render; error as % of page width). iLovePDF's own output uses positioned text boxes plus sections/columns (392 text boxes, 47 anchored objects, no editable equations), i.e. the same family of technique as the layout mode here.

| (one paper, one run) | iLovePDF app | PDF Do layout mode |
|---|---|---|
| Word pages (source = 8) | 8 | 8 |
| source words still present as text | 97.6 % | 92.6 % (figure labels are inside pictures) |
| median word position error | 0.32 % of width | 0.23 % |
| matched words within 0.6 % | 92.5 % | 84.4 % |
| matched words within 2 % | 98.7 % | 92.5 % |

PDF Do's remaining gap is concentrated on lines with inline math and on figure/chart text (kept as pictures here, as text boxes there). Editable mode (real paragraphs/columns) is a different trade-off: 10 pages, larger position error, but genuinely reflowable text. Single document - not a statistical benchmark.

## Measured results (one run, this machine)

Environment: python=3.11.15, platform=Windows-10-10.0.26200-SP0, cpu=AMD64 Family 23 Model 96 Stepping 1, AuthenticAMD, cores=12, ram_gb=8.0, pymupdf=1.28.2, docx=1.2.0, jiwer=?, pdf2docx=0.5.13, tesseract=5.4.0.20240606

| document | tool | ok | pages | WER | CER | table F1 | layout err % width | page ratio | seconds | peak MB |
|---|---|---|---|---|---|---|---|---|---|---|
| text | ours | yes | 3 | 0.0 | 0.0 | - | 2.03 | 1.0 | 2.79 | 92.2 |
| text | pdf2docx | yes | 3 | 0.0082 | 0.004 | - | 0.31 | 1.0 | 1.23 | 88.0 |
| twocol | ours | yes | 2 | 0.0 | 0.0 | - | 2.8 | 1.0 | 3.38 | 98.5 |
| twocol | pdf2docx | yes | 2 | 0.4031 | 0.3882 | - | 0.44 | 1.0 | 1.26 | 88.9 |
| tables | ours | yes | 1 | 0.0 | 0.0 | 1.0 | 7.61 | 1.0 | 1.21 | 86.0 |
| tables | pdf2docx | yes | 1 | 0.0 | 0.0 | 1.0 | 0.34 | 1.0 | 1.25 | 84.5 |
| scanned | ours | yes | 2 | 0.0264 | 0.0116 | - | - | - | 17.79 | 197.8 |
| scanned | pdf2docx | yes | 2 | 1.0 | 1.0 | - | - | - | 2.93 | 122.9 |
| mixed | ours | yes | 2 | 0.0163 | 0.0077 | - | 4.22 | 1.0 | 10.46 | 183.8 |
| mixed | pdf2docx | yes | 2 | 0.5 | 0.5001 | - | 0.31 | 1.0 | 3.15 | 117.4 |

Plots: `benchmarks/results/comparison.png`, `tables.png`. These are **synthetic documents from `testdata.py`** (3-page text, 2-page two-column, 1 bordered table, 2 scanned pages, 1 mixed 2-page file); a single run, so timings vary by a few tenths of a second. Reading them honestly:

* **Layout fidelity** (mean word position error after Word re-renders the .docx): `pdf2docx` is clearly better than this system on every layout-measured document here (0.3-0.4 % of page width vs 2-8 %). Our output keeps page counts equal on these files but positions drift, most on the table page (7.6 %).
* **Reading order / text accuracy**: on the two-column document this system recovered the text in order (WER 0.0) while `pdf2docx` interleaved the columns (WER 0.40).
* **Scanned and mixed pages**: `pdf2docx` has no OCR, so it exports nothing readable (WER 1.0 / 0.5); this system's OCR gave WER 0.026 / CER 0.012 (scanned) and WER 0.016 / CER 0.008 (mixed) on these clean synthetic scans - real scans will be worse. OCR costs time and memory (about 18 s and 198 MB for 2 pages vs 3 s and 123 MB for `pdf2docx`).
* **Table cell F1** is 1.0 for both on this single ruled table - not a statement about complex or borderless tables.
* Not measured: Microsoft Word's own PDF reflow (it hung when automated on this machine, so it is excluded by default), real-world publications (use `--extra`), languages other than English, and the 8-page two-column research paper I used while developing - there our output had more Word pages than the PDF (13 vs 8).

## Limitations (known, measured or observed)

* Page breaks: Word re-flows text, so the page count can differ from the PDF (observed: an 8-page two-column paper became 13 pages in Word in our own test; the benchmark reports the ratio per document).
* Equations are exported as images (not Word equations); inline math lines may become pictures.
* Tables: bordered tables are reconstructed well; borderless tables use a heuristic; merged cells, nested tables and cell styling are not reproduced.
* Vector figures are rasterised; text inside figures is not editable.
* Rotated text, vertical scripts, complex RTL layouts and forms/annotations other than links are not handled.
* OCR quality depends on scan quality and the installed language data; only English data is assumed by default. Handwriting is not supported.
* Fonts: embedded fonts are mapped to the nearest Word-installed family (Times New Roman, Arial, Courier New, …); exact glyph metrics are not reproduced, so line breaks can differ.
* Mixed pages (text + scanned regions on the same page) are handled per page, not per region.
* Synthetic benchmark documents are easier than real publications; use `--extra` for realistic checks.

## Layout of this folder

```
engine/        analysis.py ocr.py layout.py docx_builder.py pipeline.py models.py
app/           main.py (FastAPI) static/index.html (UI)
tests/         test_pipeline.py test_api.py
benchmarks/    run_benchmark.py plot_results.py _worker.py results/
config.py cli.py testdata.py requirements.txt
```

Third-party: PyMuPDF (AGPL-3.0 / commercial), python-docx (MIT), FastAPI (MIT), Tesseract (Apache-2.0), OpenCV (Apache-2.0), pdf2docx (GPL-3.0, benchmark only). **PyMuPDF is AGPL – if you distribute this service you must comply with the AGPL or buy a commercial licence.**

Respect copyright and privacy: only convert documents you have the right to process.
