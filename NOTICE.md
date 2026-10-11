# PDF Do - licence and third-party notices

PDF Do (c) 2026 VIN TECHNOLOGIES. Released under the **GNU Affero General Public License v3.0** (see `LICENSE`).
The conversion service links PyMuPDF (AGPL-3.0), so the whole application is distributed under the AGPL; the complete
source code must be made available to everyone who receives the program (publish this repository alongside every release).

Bundled components and their licences:
- PyMuPDF / MuPDF - AGPL-3.0 (Artifex)
- python-docx - MIT; lxml - BSD; OpenCV - Apache-2.0; NumPy - BSD; Pillow - HPND; FastAPI / Starlette / uvicorn - MIT / BSD
- Tesseract OCR 5 and `eng` / `osd` language data - Apache-2.0
- pdf.js - Apache-2.0; pdf-lib and @pdf-lib/fontkit - MIT; Tesseract.js - Apache-2.0
- Fonts from Fontsource (Inter, Lora, Playfair Display, Merriweather, Roboto Mono, Caveat, Dancing Script, Pacifico, Oswald,
  Montserrat, Poppins, Space Grotesk, Source Serif 4, Great Vibes, Bebas Neue, Abril Fatface) - SIL Open Font License 1.1
  (licence files in `assets/fonts`)
`pdf2docx` is used only by the optional benchmark script and is not shipped.
