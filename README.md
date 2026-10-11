# PDF Do

A private, offline PDF studio that runs as a standalone Microsoft Edge app window.
No sign-in. No cloud. Your files never leave the computer.

## Single-file editions

* **`dist\PDFDo-Portable.exe`** - one file, nothing to install: first run unpacks itself to `%LOCALAPPDATA%\PDFDo\portable\<id>` (a few seconds), later runs start immediately. Keep it anywhere (USB stick, Desktop).
* **`dist\PDFDoSetup.exe`** - installer (Start menu / Desktop shortcut, Open with, Apps & features entry).

## Install (single file)

Run **`dist\PDFDoSetup.exe`** (168 MB, no admin rights): installs to `%LOCALAPPDATA%\Programs\PDFDo`, adds Desktop/Start shortcuts and *Open with → PDF Do*, and registers an uninstaller in Settings → Apps. It contains the app, the Edge launcher, and the **local conversion service** (PyMuPDF layout engine + bundled Tesseract OCR, English). PDFDo.exe starts the service on `127.0.0.1` with a random port and access token, opens the app in its own Edge window, and stops the service when the last window closes. Convert → Word then uses the high-fidelity engine (columns, tables, images, OCR for scans); if the service is not running the built-in exporter is used.

Rebuild everything: `pdf2docx_serviceuild_service.ps1` (once) → `build.ps1` → `build-setup.ps1`. Details and measured benchmarks: `pdf2docx_service\README.md`.

## Run it

* **Quick start:** double-click `PDFDo.exe`.
* **Install (adds Start menu + Desktop shortcut and "Open with → PDF Do"):** double-click `Install PDF Do.cmd`.
* **Uninstall:** `Uninstall PDF Do.cmd` (or Settings → Apps).

Requires Windows 10/11 with Microsoft Edge (preinstalled). PDF Do opens in its own Edge app window with a private profile, so it never touches your browser tabs or history.

## Rebuild from source

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Output: `dist\PDFDo\` (launcher `PDFDo.exe` + `app\`). The launcher is compiled with the .NET Framework compiler that ships with Windows — nothing to install.

You can also open `index.html` directly in Edge for development (everything works except launching with a file argument).

## Features

| Area | What you can do |
|---|---|
| **Read** | Continuous / single / two-page / book layouts, fit width / page, zoom, night & sepia modes, thumbnails, bookmarks, full-text search with highlights, presentation mode, read aloud, back / forward history (Alt+←/→), tabs for many documents, recent & pinned files, crash-recovery of unsaved work |
| **Annotate** | Highlight, underline, strikethrough, squiggly (from selected text), area highlight, pen, rectangle, ellipse, line, arrow, **measure distance (mm / cm / in, with scale)**, text boxes, sticky notes, stamps, eraser — colors, opacity, dashes, move / resize / rotate, undo & redo |
| **Edit** | Rewrite existing text in place, add text with **any font** (bundled families, your own .ttf/.otf/.woff files, or fonts installed on the PC) plus bold, italic, underline, strikethrough, size, color, background, alignment, line height, letter spacing, rotation; insert images; draw / type / upload signatures; whiteout; hyperlinks |
| **Pages** | Visual grid with drag-to-reorder, rotate, delete, duplicate, extract, insert blank / from another PDF, reverse, odd/even, duplex-scan collate, split (every N, ranges, one page each, by bookmarks), crop (margins or auto-trim), change page size, bookmarks editor, page numbers, headers / footers / Bates numbering, watermark (text or image) |
| **Merge** | Combine PDFs and images, per-file page ranges, drag ordering, sort by name / date / size, bookmark per file |
| **Compare** | Two PDFs side by side, overlay, swipe, word-level text diff, sensitivity control, per-page change summary, HTML report |
| **Convert** | PDF → PNG / JPG, Word (.docx, layout-aware: fonts, alignment, columns, pictures), text, Markdown, HTML; extract embedded pictures; images → PDF; text → PDF; OCR (English, fully offline) with searchable-PDF output |
| **Protect** | **Password protection with AES-256 and permission flags** (print / copy / edit / comment …), true redaction (affected pages are rebuilt, content removed, the rest stays searchable), remove protection, flatten, compress, sanitize hidden data, edit / strip metadata |
| **Forms** | Fill text fields, checkboxes, dropdowns, radio groups; add new fields; flatten |

Press **Ctrl+K** anywhere for the command palette.

## Notes

* Annotations are embedded into the page content when you save (they are editable until then, including after undo/redo). Sticky notes also write a standard PDF comment.
* Password-protected PDFs open after you enter the password. To *edit* a protected PDF, PDF Do offers to unlock it by rebuilding its pages as images.
* OCR language data for English is bundled; the OCR engine, PDF engine and fonts all ship inside the app.

## Third-party components (bundled)

pdf.js (Apache-2.0), pdf-lib (MIT), @pdf-lib/fontkit (MIT), Tesseract.js + tesseract-core (Apache-2.0), tessdata "eng" (Apache-2.0), and Fontsource fonts: Inter, Lora, Playfair Display, Merriweather, Roboto Mono, Caveat, Dancing Script, Pacifico, Oswald, Montserrat, Poppins, Space Grotesk, Source Serif 4, Great Vibes, Bebas Neue, Abril Fatface (SIL Open Font License; license files are in `assets/fonts`).
