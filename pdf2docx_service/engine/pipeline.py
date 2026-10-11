"""Orchestrates the conversion: analysis -> (OCR) -> layout -> DOCX. Returns a report with per-page decisions and timings."""
from __future__ import annotations

import time
import tracemalloc
from dataclasses import dataclass, field, asdict
from typing import Callable, List, Optional

import fitz

from config import settings
from . import analysis, layout, ocr
from .docx_builder import build_docx
from .models import ImageBlock, Line, PageModel


@dataclass
class ConversionOptions:
    ocr: str = "auto"                  # auto | always | never
    ocr_lang: str = "eng"
    ocr_dpi: int = 300
    pages: Optional[List[int]] = None  # 0-based page indices, None = all
    detect_tables: bool = True
    math_as_image: bool = True
    headers_footers: bool = True
    preprocess_denoise: bool = True
    preprocess_deskew: bool = True
    preprocess_binarize: bool = True
    mode: str = "layout"              # layout (default: page count + placement preserved) | editable (reflowing paragraphs) | layout (every element at its original absolute position)


@dataclass
class ConversionReport:
    pages: int = 0
    native_pages: int = 0
    ocr_pages: int = 0
    tables: int = 0
    images: int = 0
    figures: int = 0
    math_regions: int = 0
    editable_equations: int = 0
    seconds: float = 0.0
    peak_python_mb: float = 0.0
    mean_ocr_confidence: Optional[float] = None
    warnings: List[str] = field(default_factory=list)
    per_page: List[dict] = field(default_factory=list)
    mode: str = "editable"
    quality: dict = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)


class ConversionError(Exception):
    pass


def convert_pdf(pdf_path: str, docx_path: str, options: Optional[ConversionOptions] = None,
                progress: Optional[Callable[[float, str], None]] = None) -> ConversionReport:
    options = options or ConversionOptions()
    rep = ConversionReport()
    t0 = time.perf_counter()
    tracemalloc.start()
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        raise ConversionError("The file could not be opened as a PDF") from e
    if doc.needs_pass:
        raise ConversionError("The PDF is password-protected")
    if doc.page_count > settings.max_pages:
        raise ConversionError("The PDF has %d pages; the limit is %d" % (doc.page_count, settings.max_pages))
    idx = [i for i in (options.pages or range(doc.page_count)) if 0 <= i < doc.page_count]
    if not idx:
        raise ConversionError("No valid pages selected")
    settings.render_math_as_image = options.math_as_image
    rep.pages = len(idx)
    ocr_ok = ocr.ocr_available()
    if options.ocr != "never" and not ocr_ok:
        rep.warnings.append("OCR engine unavailable: scanned pages will be exported as page images")

    raw: List[dict] = []
    all_lines_for_body: List[Line] = []
    confs: List[float] = []
    # ---- pass 1: analysis / OCR per page ----
    for n, i in enumerate(idx):
        page = doc[i]
        if progress:
            progress(0.05 + 0.6 * n / len(idx), "Analysing page %d of %d" % (i + 1, doc.page_count))
        kind, stats = analysis.classify_page(page)
        use_ocr = options.ocr == "always" or (options.ocr == "auto" and kind in ("scanned",))
        entry = {"index": i, "class": kind, "stats": stats, "page": page}
        if use_ocr and ocr_ok:
            try:
                lines, conf, info = ocr.ocr_page(page, options.ocr_lang, options.ocr_dpi, options.preprocess_denoise,
                                                 options.preprocess_deskew, options.preprocess_binarize)
                entry.update(source="ocr", lines=lines, conf=conf, ocr_info=info, images=[], tables=[])
                confs.append(conf)
                if not lines:
                    rep.warnings.append("Page %d: OCR found no text" % (i + 1))
                    entry["lines"] = []
            except Exception as e:  # keep going with a picture of the page
                rep.warnings.append("Page %d: OCR failed (%s)" % (i + 1, e))
                use_ocr = False
        if not (use_ocr and ocr_ok and entry.get("source") == "ocr"):
            lines = analysis.extract_lines(page)
            images = analysis.extract_images(page, doc)
            bg = None
            if options.mode == "layout":
                # layout mode: no Word tables / figure crops. Artwork becomes a background picture, all text stays positioned text.
                tables, figs = [], []
                bg = analysis.render_background(page, doc)
            else:
                tables = analysis.extract_tables(page) if options.detect_tables else []
                if options.detect_tables:
                    rt = analysis.extract_rule_tables(page, lines)
                    tables = [t for t in tables if not any(fitz.Rect(t.bbox).intersects(fitz.Rect(r.bbox)) for r in rt)] + rt
                solid = [t.bbox for t in tables if len(t.rows) >= 3 and sum(1 for r in t.rows for c in r if c.strip()) >= 0.8 * sum(len(r) for r in t.rows)]
                figs = analysis.extract_vector_figures(page, lines, images, solid)
                tables = analysis.validate_tables(page, tables, images + figs, lines)
            entry.update(source="native", lines=lines, images=images + figs, tables=tables, background=bg)
            if kind == "scanned" and not ocr_ok:
                # keep the look: full-page picture
                png = page.get_pixmap(dpi=200).tobytes("png")
                entry["images"] = [ImageBlock(bbox=(0, 0, page.rect.width, page.rect.height), png=png, kind="image")]
        raw.append(entry)
        all_lines_for_body.extend(entry["lines"])
    body = layout.body_font_size(all_lines_for_body)

    # ---- pass 2: math, layout, headers/footers ----
    models: List[PageModel] = []
    hf_input = []
    for n, e in enumerate(raw):
        page = e["page"]
        if progress:
            progress(0.65 + 0.2 * n / len(raw), "Analysing layout of page %d" % (e["index"] + 1))
        lines, math_imgs = layout.mark_math_regions(page, e["lines"], [t.bbox for t in e["tables"]]) if e["source"] == "native" else (e["lines"], [])
        pm = layout.build_page(e["index"], page, lines, e["images"] + math_imgs, e["tables"], e["source"], body, e.get("conf"))
        pm.background_img = e.get("background")
        models.append(pm)
        hf_input.append((pm, lines))
        rep.tables += len(e["tables"])
        rep.images += sum(1 for im in e["images"] if im.kind == "image")
        rep.figures += sum(1 for im in e["images"] if im.kind == "figure")
        rep.math_regions += len(math_imgs)
        rep.editable_equations += sum(1 for m in math_imgs if getattr(m, 'kind', '') == 'omml')
        if e["source"] == "ocr":
            rep.ocr_pages += 1
        else:
            rep.native_pages += 1
        rep.per_page.append({"page": e["index"] + 1, "class": e["class"], "source": e["source"], "chars": e["stats"]["chars"],
                             "image_cover": e["stats"]["image_cover"], "ocr_conf": round(e["conf"], 1) if e.get("conf") is not None else None,
                             "ocr": e.get("ocr_info")})
    if options.headers_footers and len(models) >= 2:
        layout.detect_headers_footers(hf_input)
        for pm, lines in hf_input:
            rebuilt = layout.strip_header_footer_lines(lines, pm.header, pm.footer)
            if len(rebuilt) != len(lines):
                for b in pm.bands:
                    for ci, col in enumerate(b.items):
                        b.items[ci] = [it for it in col if not (hasattr(it, "lines") and all(l in pm.header + pm.footer for l in it.lines))]
                pm.bands = [b for b in pm.bands if any(b.items)]
    # ---- DOCX ----
    def prog(i, n):
        if progress:
            progress(0.85 + 0.14 * i / n, "Writing Word page %d of %d" % (i, n))
    build_docx(models, docx_path, prog, options.mode)
    rep.mode = options.mode
    rep.quality = _quality(doc, models, docx_path, rep)
    rep.mean_ocr_confidence = round(sum(confs) / len(confs), 1) if confs else None
    rep.seconds = round(time.perf_counter() - t0, 3)
    cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    rep.peak_python_mb = round(peak / 1e6, 1)
    doc.close()
    if progress:
        progress(1.0, "Done")
    return rep


def _quality(doc, models, docx_path, rep):
    """Measured self-checks on the produced file (no renderer needed): package integrity, text completeness (characters of the
    source text layer vs characters present as editable text in the .docx) and which regions were rasterised."""
    import re
    import zipfile
    from docx import Document
    norm = lambda t: re.sub(r"\s+", "", t)
    out = {"integrity": "ok", "pages": [], "notes": []}
    try:
        with zipfile.ZipFile(docx_path) as z:
            xml = z.read("word/document.xml").decode("utf8", "ignore")
            if z.testzip() or "<w:document" not in xml:
                out["integrity"] = "damaged"
        d = Document(docx_path)
        text = norm("".join(p.text for p in d.paragraphs) + "".join(c.text for t in d.tables for r in t.rows for c in r.cells))
        for sec in d.sections:
            text += norm("".join(p.text for p in sec.footer.paragraphs) + "".join(p.text for p in sec.header.paragraphs))
    except Exception as e:                                 # noqa: BLE001
        out["integrity"] = "unreadable: %s" % e
        return out
    src_total = 0
    for pm in models:
        src = norm(doc[pm.index].get_text("text")) if pm.source == "native" else ""
        src_total += len(src)
        imgs = sum(1 for b in pm.bands for col in b.items for it in col if hasattr(it, "png"))
        out["pages"].append({"page": pm.index + 1, "source": pm.source, "source_chars": len(src), "raster_regions": imgs,
                             "ocr_confidence": round(pm.ocr_conf, 1) if pm.ocr_conf is not None else None})
    got = len(text)
    out["text_completeness"] = round(min(1.0, got / src_total), 3) if src_total else None
    out["editable_text_chars"] = got
    pics = rep.math_regions - rep.editable_equations
    if rep.editable_equations:
        out["notes"].append("%d equation(s) are editable Word equations (single-line, scripts preserved)" % rep.editable_equations)
    if pics > 0:
        out["notes"].append("%d stacked equation region(s) (fractions, sums) are pictures, not editable math" % pics)
    if rep.figures:
        out["notes"].append("%d figure(s) are pictures; text inside them is not editable" % rep.figures)
    if rep.ocr_pages:
        out["notes"].append("%d page(s) were OCR'd; check the text against the scan" % rep.ocr_pages)
    if out["text_completeness"] is not None and out["text_completeness"] < 0.9:
        out["notes"].append("only %.0f%% of the PDF text layer is present as editable text (the rest is inside pictures)" % (100 * out["text_completeness"]))
    return out
