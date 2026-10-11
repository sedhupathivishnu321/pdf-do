"""Stage 1 - PDF analysis. Extracts spans (font, size, style, colour, position), images, vector figures,
tables and hyperlinks from a PyMuPDF page, and classifies the page as native-text or scanned."""
from __future__ import annotations

import re
from typing import List, Tuple

import fitz  # PyMuPDF

from config import settings
from .models import ImageBlock, Line, Span, TableBlock

FLAG_ITALIC, FLAG_SERIF, FLAG_MONO, FLAG_BOLD = 2, 4, 8, 16
_MATH_FONT = re.compile(r"(cmmi|cmsy|cmex|msam|msbm|eufm|rsfs|mathit|mathematical|stix.*math|cambria ?math|^symbol)", re.I)
_MATH_CHARS = re.compile(r"[∀-⋿←-⇿⟀-⟯⦀-⫿Α-ω∑∫√±×÷≤≥≠≈]")


def is_math_font(name: str) -> bool:
    return bool(_MATH_FONT.search(name or ""))


def clean_font_name(name: str) -> str:
    return re.sub(r"^[A-Z]{6}\+", "", name or "")


def classify_page(page: fitz.Page) -> Tuple[str, dict]:
    """Return ('native'|'scanned'|'mixed', stats). A page is *scanned* when it has (almost) no selectable text and an image
    covers most of it. Pages with text and a big full-page image (e.g. OCR'd scans with a hidden text layer) are 'native'."""
    text = page.get_text("text")
    nchars = len(re.sub(r"\s", "", text))
    area = max(1.0, page.rect.width * page.rect.height)
    cover = 0.0
    for info in page.get_image_info():
        r = fitz.Rect(info["bbox"]) & page.rect
        cover += max(0.0, r.width * r.height)
    cover = min(1.0, cover / area)
    stats = {"chars": nchars, "image_cover": round(cover, 3)}
    if nchars < settings.min_native_chars:
        return ("scanned" if cover > 0.35 or nchars == 0 and page.get_drawings() == [] else "native"), stats
    if cover > 0.6 and nchars < 4 * settings.min_native_chars:
        return "mixed", stats
    return "native", stats


def extract_lines(page: fitz.Page) -> List[Line]:
    """All text lines on the page with span-level style, in raw PDF order."""
    d = page.get_text("dict", flags=fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP)
    links = [(fitz.Rect(l["from"]), l["uri"]) for l in page.get_links() if l.get("kind") == fitz.LINK_URI and l.get("uri")]
    lines: List[Line] = []
    for b in d["blocks"]:
        if b.get("type") != 0:
            continue
        for ln in b["lines"]:
            if abs(ln["dir"][1]) > 0.05:           # rotated text is left to the figure path
                continue
            spans: List[Span] = []
            for sp in ln["spans"]:
                if not sp["text"].strip() and not sp["text"]:
                    continue
                fl = sp["flags"]
                fname = clean_font_name(sp["font"])
                bold = bool(fl & FLAG_BOLD) or bool(re.search(r"bold|black|heavy|semibold|\bbx|-bf", fname, re.I))
                ital = bool(fl & FLAG_ITALIC) or bool(re.search(r"italic|oblique|-it\b|\bti\d|\bmi\d", fname, re.I))
                bb = tuple(sp["bbox"])
                link = None
                cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
                for r, uri in links:
                    if r.contains(fitz.Point(cx, cy)):
                        link = uri
                        break
                kind = "mono" if fl & FLAG_MONO else ("serif" if fl & FLAG_SERIF else "sans")
                spans.append(Span(kind=kind, text=sp["text"], font=fname, size=round(sp["size"], 2), bold=bold, italic=ital,
                                  color=sp["color"], bbox=bb, origin=tuple(sp["origin"]), link=link,
                                  superscript=bool(fl & 1)))
            if not spans or not "".join(s.text for s in spans).strip():
                continue
            # sub/superscripts: clearly smaller spans whose origin is raised / lowered against the dominant baseline
            main = max(spans, key=lambda x: (x.size, len(x.text.strip())))
            msize = max(x.size for x in spans)
            for x in spans:
                if x.size < 0.86 * msize and x.text.strip():
                    dy = x.origin[1] - main.origin[1]
                    if dy < -0.18 * msize:
                        x.superscript = True
                    elif dy > 0.12 * msize:
                        x.subscript = True
                    x.size = round(x.size / 0.7, 1) if (x.superscript or x.subscript) else x.size   # Word scales script runs to ~65 %
            # PyMuPDF groups everything on one baseline into a line, even across column gutters / tab stops: split at wide gaps
            groups, cur = [], [spans[0]]
            for a, b2 in zip(spans[:-1], spans[1:]):
                gap = b2.bbox[0] - a.bbox[2]
                if gap > max(9.0, 0.9 * max(a.size, b2.size)) and a.text.strip() and b2.text.strip():
                    groups.append(cur); cur = [b2]
                else:
                    cur.append(b2)
            groups.append(cur)
            for g in groups:
                if not "".join(x.text for x in g).strip():
                    continue
                x0 = min(x.bbox[0] for x in g); y0 = min(x.bbox[1] for x in g); x1 = max(x.bbox[2] for x in g); y1 = max(x.bbox[3] for x in g)
                lines.append(Line(spans=g, bbox=(x0, y0, x1, y1), baseline=g[0].origin[1]))
    return _dedupe(lines)


def _dedupe(lines: List[Line]) -> List[Line]:
    """Remove faux-bold double strikes and hidden duplicate layers (same text at (almost) same place)."""
    out: List[Line] = []
    for ln in lines:
        dup = False
        for o in out:
            if o.text == ln.text and abs(o.bbox[0] - ln.bbox[0]) < 1.5 and abs(o.bbox[1] - ln.bbox[1]) < 1.5:
                dup = True
                break
        if not dup:
            out.append(ln)
    return out


def extract_images(page: fitz.Page, doc: fitz.Document) -> List[ImageBlock]:
    """Raster images with their placement. Soft-masked / CMYK images are normalised to RGB(A) PNG."""
    out: List[ImageBlock] = []
    for info in page.get_image_info(xrefs=True):
        bbox = fitz.Rect(info["bbox"]) & page.rect
        if bbox.is_empty or bbox.width < 4 or bbox.height < 4:
            continue
        if bbox.width * bbox.height > 0.93 * page.rect.width * page.rect.height and len(page.get_text("text").strip()) > settings.min_native_chars:
            continue  # page-size background behind real text
        xref = info.get("xref", 0)
        try:
            if xref:
                pix = fitz.Pixmap(doc, xref)
                if info.get("has-mask") or pix.alpha:
                    pass
                if pix.colorspace and pix.colorspace.n > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                png = pix.tobytes("png")
            else:
                raise ValueError
        except Exception:
            png = page.get_pixmap(clip=bbox, dpi=200).tobytes("png")
        out.append(ImageBlock(bbox=(bbox.x0, bbox.y0, bbox.x1, bbox.y1), png=png, kind="image"))
    return out


def extract_vector_figures(page: fitz.Page, text_lines: List[Line], image_boxes: List[ImageBlock], exclude=()) -> List[ImageBlock]:
    """Cluster vector drawings (charts, diagrams, logos) into rectangles and render them as images, together with any text
    that sits inside them (labels stay part of the figure so the diagram is not torn apart)."""
    all_draws = [d0["rect"] for d0 in page.get_drawings()]
    rects: List[fitz.Rect] = []
    for dr in page.get_drawings():
        r = dr["rect"]
        if r.width < 1 and r.height < 1:
            continue
        if (r.width < 0.6 or r.height < 0.6) and max(r.width, r.height) < 60:
            continue  # table rules / underlines are handled by the table finder
        if r.width > 0.85 * page.rect.width and r.height > 0.4 * page.rect.height:
            continue  # page-size backgrounds / clip rectangles would swallow every real figure
        if r.x0 < -5 or r.y0 < -5 or r.x1 > page.rect.width + 5 or r.y1 > page.rect.height + 5:
            continue  # clip paths reaching outside the page
        rects.append(fitz.Rect(r))
    clusters: List[fitz.Rect] = []
    for r in rects:
        r2 = fitz.Rect(r.x0 - 6, r.y0 - 6, r.x1 + 6, r.y1 + 6)
        merged = False
        for i, c in enumerate(clusters):
            if c.intersects(r2):
                clusters[i] = c | r2
                merged = True
                break
        if not merged:
            clusters.append(r2)
    changed = True
    while changed:
        changed = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                if clusters[i].intersects(clusters[j]):
                    clusters[i] |= clusters[j]
                    clusters.pop(j)
                    changed = True
                    break
            if changed:
                break
    figs: List[ImageBlock] = []
    for c in clusters:
        c = c & page.rect
        if c.width < 24 or c.height < 24:
            continue
        if c.width > 0.95 * page.rect.width and c.height > 0.95 * page.rect.height:
            continue
        inside = [l for l in text_lines if fitz.Rect(l.bbox).intersects(c) and fitz.Rect(l.bbox).get_area() > 0
                  and (fitz.Rect(l.bbox) & c).get_area() / fitz.Rect(l.bbox).get_area() > 0.7]
        ndraw = sum(1 for d0 in all_draws if c.intersects(d0))
        if len(inside) > 30 and ndraw < 0.5 * len(inside):
            continue                          # big bordered text area, not a figure (a chart has many more drawn marks than labels)
        if any(fitz.Rect(i.bbox).contains(c) for i in image_boxes):
            continue
        if any((c & fitz.Rect(b)).get_area() > 0.6 * c.get_area() for b in exclude):
            continue  # a ruled table, not a figure
        png = page.get_pixmap(clip=c, dpi=220).tobytes("png")
        figs.append(ImageBlock(bbox=(c.x0, c.y0, c.x1, c.y1), png=png, kind="figure"))
    return figs


def extract_tables(page: fitz.Page) -> List[TableBlock]:
    out: List[TableBlock] = []
    try:
        finder = page.find_tables()
        tabs = list(finder.tables)
        if not tabs:
            # borderless tables: infer columns from aligned text; accept only compact, multi-column, mostly-short-cell results
            for t in page.find_tables(strategy="text").tables:
                x0, y0, x1, y1 = t.bbox
                if t.row_count >= 3 and t.col_count >= 3 and (y1 - y0) < 0.6 * page.rect.height and (x1 - x0) < 0.98 * page.rect.width:
                    cells = t.extract()
                    filled = sum(1 for r in cells for c in r if c and c.strip())
                    longc = sum(1 for r in cells for c in r if c and len(c) > 40)
                    if filled >= 0.55 * t.row_count * t.col_count and longc <= 0.1 * filled:
                        tabs.append(t)
    except Exception:
        return out
    for t in tabs:
        try:
            rows = t.extract()
        except Exception:
            continue
        if not rows or len(rows) < 2 or len(rows[0]) < 2:
            continue
        cells = [[(c or "").replace("\n", " ").strip() for c in r] for r in rows]
        if sum(1 for r in cells for c in r if c) < 4:
            continue
        x0, y0, x1, y1 = t.bbox
        widths: List[float] = []
        try:
            first = [c for c in t.rows[0].cells if c]
            widths = [c[2] - c[0] for c in first]
        except Exception:
            pass
        out.append(TableBlock(bbox=(x0, y0, x1, y1), rows=cells, col_widths=widths, header=bool(getattr(t, "header", None) and t.header.external is False)))
    return out


def mathiness(line: Line) -> float:
    """Fraction of glyphs in the line that look mathematical (math fonts or math Unicode ranges)."""
    total = math = 0
    for s in line.spans:
        n = len(s.text.strip())
        if not n:
            continue
        total += n
        if is_math_font(s.font):
            math += n
        else:
            math += len(_MATH_CHARS.findall(s.text))
    return math / total if total else 0.0


def validate_tables(page: fitz.Page, tables: List[TableBlock], figures: List[ImageBlock], lines: List[Line]) -> List[TableBlock]:
    """Drop false tables (axis labels of charts, diagram labels, text laid out in columns) and attach font size / alignment.
    A table is kept only if it does not sit on a figure/picture, most cells are filled, it is not made of fragments of words,
    and (for borderless candidates) there is no vector drawing underneath it."""
    out: List[TableBlock] = []
    draws = [d["rect"] for d in page.get_drawings()]
    for t in tables:
        tr = fitz.Rect(t.bbox)
        area = max(1.0, tr.get_area())
        if sum((tr & fitz.Rect(f.bbox)).get_area() for f in figures) / area > 0.25:
            continue
        cells = [c for r in t.rows for c in r]
        filled = [c for c in cells if c.strip()]
        if len(filled) < 0.45 * len(cells):
            continue
        avg = sum(len(c) for c in filled) / max(1, len(filled))
        if avg < 1.8:
            continue
        # split-word fragments ("Surfa" / "ce") mean the grid was imposed on free text
        frag = sum(1 for c in filled if len(c) <= 3 and c.isalpha())
        if frag > 0.35 * len(filled):
            continue
        rules = [d for d in draws if tr.intersects(d) and (d.width < 1.5 or d.height < 1.5)]
        if len(rules) < 2 and len(t.rows) > 3 and (tr.width > 0.9 * page.rect.width):
            continue
        inside = [l for l in lines if tr.contains(fitz.Rect(l.bbox)) or (fitz.Rect(l.bbox) & tr).get_area() > 0.6 * max(1.0, fitz.Rect(l.bbox).get_area())]
        if inside:
            sizes = sorted(l.size for l in inside)
            t.font_size = max(5.0, min(14.0, round(sizes[len(sizes) // 2] * 2) / 2))
        ncols = max(len(r) for r in t.rows)
        al = []
        for ci in range(ncols):
            col = [r[ci] for r in t.rows[1:] if ci < len(r) and r[ci].strip()]
            numeric = col and sum(1 for c in col if re.fullmatch(r"[-+−]?[\d.,]+\s*(%|[a-zA-Z]{0,3})?", c.strip())) >= 0.7 * len(col)
            al.append("right" if numeric else "left")
        t.aligns = al
        out.append(t)
    return out


def extract_rule_tables(page: fitz.Page, lines: List[Line]) -> List[TableBlock]:
    """Tables drawn with horizontal rules only (journal 'booktabs' style): >=2 parallel full-width rules form the frame; the text
    between them is split into rows by baseline and into columns by empty vertical gaps."""
    rules = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.height < 1.6 and r.width > 60 and r.width < 0.97 * page.rect.width:
            rules.append(fitz.Rect(r.x0, (r.y0 + r.y1) / 2, r.x1, (r.y0 + r.y1) / 2))
    rules.sort(key=lambda r: (round(r.x0 / 6), r.y0))
    groups: List[List[fitz.Rect]] = []
    for r in rules:
        for g in groups:
            if abs(g[0].x0 - r.x0) < 6 and abs(g[0].x1 - r.x1) < 6 and r.y0 - g[-1].y0 < 400:
                g.append(r); break
        else:
            groups.append([r])
    out: List[TableBlock] = []
    for g in groups:
        if len(g) < 2:
            continue
        x0, x1 = min(r.x0 for r in g), max(r.x1 for r in g)
        y0, y1 = g[0].y0, g[-1].y0
        inside = [l for l in lines if l.bbox[1] >= y0 - 1 and l.bbox[3] <= y1 + 2 and l.bbox[0] >= x0 - 3 and l.bbox[2] <= x1 + 3]
        if len(inside) < 4:
            continue
        words = [w for w in page.get_text("words", clip=fitz.Rect(x0 - 3, y0 - 1, x1 + 3, y1 + 2)) if w[1] >= y0 - 1 and w[3] <= y1 + 2]
        words = [(w[0], w[1], w[2], w[3], w[4]) for w in words]
        if len(words) < 6:
            continue
        # rows by baseline (word bottom); columns by empty vertical gaps >= 4.5 pt between words
        words.sort(key=lambda w: (round(w[3] / 2.0), w[0]))
        rows_w: List[List[tuple]] = []
        for w in sorted(words, key=lambda w: (w[3], w[0])):
            if rows_w and abs(rows_w[-1][0][3] - w[3]) < 3.0:
                rows_w[-1].append(w)
            else:
                rows_w.append([w])
        rows = rows_w
        iv = sorted((w[0], w[2]) for w in words)
        merged_iv = [list(iv[0])]
        for a0, a1 in iv[1:]:
            if a0 - merged_iv[-1][1] < 3.4:          # an ordinary word space is ~2.5 pt; column gaps are wider
                merged_iv[-1][1] = max(merged_iv[-1][1], a1)
            else:
                merged_iv.append([a0, a1])
        cuts = [(merged_iv[i][1] + merged_iv[i + 1][0]) / 2 for i in range(len(merged_iv) - 1)]
        edges = [x0] + cuts + [x1]
        ncols = len(edges) - 1
        if ncols < 2 or len(rows) < 2:
            continue
        grid = [["" for _ in range(ncols)] for _ in rows]
        for ri, r in enumerate(rows):
            for w in sorted(r, key=lambda q: q[0]):
                cx = (w[0] + w[2]) / 2
                ci = max(0, min(ncols - 1, next((i for i in range(ncols) if edges[i] <= cx < edges[i + 1]), ncols - 1)))
                grid[ri][ci] = (grid[ri][ci] + " " + w[4]).strip()
        # merge wrapped cells: a row with a single filled cell directly under another row's same column is a continuation
        merged_grid, merged_rows = [], []
        for ri, r in enumerate(grid):
            fill = [i for i, c in enumerate(r) if c]
            if merged_grid and len(fill) == 1 and rows[ri][0][3] - rows[ri - 1][0][3] < 1.6 * (rows[ri][0][3] - rows[ri][0][1]):
                i = fill[0]
                merged_grid[-1][i] = (merged_grid[-1][i] + " " + r[i]).strip()
                merged_rows[-1] = merged_rows[-1] + rows[ri]
            else:
                merged_grid.append(r[:]); merged_rows.append(rows[ri])
        grid, rows = merged_grid, merged_rows
        if len(rows) < 2:
            continue
        # header rows = rows above the 2nd rule when there are three rules
        hdr = 1
        if len(g) >= 3:
            hdr = max(1, sum(1 for r in rows if r[0][3] < g[1].y0 + 1))
        filled = sum(1 for r in grid for c in r if c)
        if filled < 0.5 * len(rows) * ncols:
            continue
        widths = [edges[i + 1] - edges[i] for i in range(ncols)]
        out.append(TableBlock(bbox=(x0, y0 - 1, x1, y1 + 1), rows=grid, col_widths=widths, header=True, grid="horizontal", header_rows=hdr))
    return out


def render_background(page: fitz.Page, doc: fitz.Document, dpi: int = 170):
    """Picture of the page's vector artwork (rules, borders, cell shading, diagram strokes) with all text AND raster images
    removed. Placed behind positioned text it reproduces tables, boxes and figures exactly while every word stays editable.
    Returns PNG bytes, or None when the page has (almost) no vector artwork."""
    draws = page.get_drawings()
    art = [d for d in draws if not (d["rect"].width > 0.9 * page.rect.width and d["rect"].height > 0.9 * page.rect.height and d.get("fill") in ((1, 1, 1), None))]
    if len(art) < 3:
        return None
    tmp = fitz.open()
    try:
        tmp.insert_pdf(doc, from_page=page.number, to_page=page.number)
        pg = tmp[0]
        words = pg.get_text("words")
        for w in words:
            pg.add_redact_annot(fitz.Rect(w[0] - 0.4, w[1] - 0.4, w[2] + 0.4, w[3] + 0.4))
        pg.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        imgs = pg.get_image_info()
        if imgs:
            for im in imgs:
                pg.add_redact_annot(fitz.Rect(im["bbox"]))
            pg.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
        return pg.get_pixmap(dpi=dpi, alpha=False).tobytes("png")
    except Exception:
        return None
    finally:
        tmp.close()
