"""Stage 3 - layout analysis. Turns raw lines / images / tables of one page into an ordered, structured PageModel:
column detection (vertical-gutter search on a coverage profile), reading order (bands), paragraph grouping, heading and list
detection, alignment inference, math-region detection and cross-page header/footer detection."""
from __future__ import annotations

import re
import statistics
from collections import Counter
from typing import Dict, List, Optional, Sequence, Tuple

import fitz
import numpy as np

from config import settings
from .analysis import mathiness
from .models import Band, ImageBlock, Line, MathBlock, PageModel, Paragraph, Span, TableBlock

_BULLET = re.compile(r"^\s*([•●◦▪‣⁃∙\-–—\*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[ivxlc]{1,5}[.)])\s+")


# ----------------------------------------------------------------------------------- geometry helpers
def _rect(b) -> fitz.Rect:
    return fitz.Rect(*b)


def _overlap_y(a, b) -> float:
    return max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def body_font_size(lines: Sequence[Line]) -> float:
    cnt: Counter = Counter()
    for l in lines:
        n = len(l.text.strip())
        if n:
            cnt[round(l.size * 2) / 2] += n
    return cnt.most_common(1)[0][0] if cnt else 10.0


# ----------------------------------------------------------------------------------- columns
def detect_columns(lines: Sequence[Line], page_w: float, y0: float, y1: float) -> List[Tuple[float, float]]:
    """Column x-ranges inside a horizontal band. A gutter is a vertical stripe, at least `column_gap_min_pt` wide,
    that no (non page-wide) line crosses, with substantial text on both sides."""
    cand = [l for l in lines if l.bbox[1] >= y0 - 1 and l.bbox[3] <= y1 + 1 and (l.bbox[2] - l.bbox[0]) < 0.62 * page_w]
    if len(cand) < 6:
        return [(min((l.bbox[0] for l in lines), default=0.0), max((l.bbox[2] for l in lines), default=page_w))]
    lo = int(min(l.bbox[0] for l in cand)); hi = int(max(l.bbox[2] for l in cand)) + 1
    cover = np.zeros(hi - lo + 2, dtype=np.int32)
    for l in cand:
        cover[int(l.bbox[0]) - lo: int(l.bbox[2]) - lo + 1] += 1
    gutters = []
    start = None
    for x in range(len(cover)):
        empty = cover[x] <= max(1, int(0.06 * len(cand))) and x < len(cover) - 1
        if empty and start is None:
            start = x
        if not empty and start is not None:
            if x - start >= settings.column_gap_min_pt and start > 0:
                gutters.append((start + x) / 2 + lo)
            start = None
    cuts = []
    for g in gutters:
        left = sum(1 for l in cand if l.bbox[2] <= g)
        right = sum(1 for l in cand if l.bbox[0] >= g)
        if left >= 3 and right >= 3:
            cuts.append(g)
    if not cuts:
        return [(lo, hi)]
    edges = [lo] + cuts + [hi]
    cols = []
    for a, b in zip(edges[:-1], edges[1:]):
        inside = [l for l in cand if (l.bbox[0] + l.bbox[2]) / 2 >= a and (l.bbox[0] + l.bbox[2]) / 2 < b and not any(l.bbox[0] < g - 2 and l.bbox[2] > g + 2 for g in cuts)]
        if inside:
            cols.append((min(l.bbox[0] for l in inside), max(l.bbox[2] for l in inside)))
    return cols or [(lo, hi)]


def split_bands(lines: Sequence[Line], page_w: float, page_h: float) -> List[Tuple[float, float, List[Tuple[float, float]]]]:
    """Cut the page into bands: full-width lines (titles, spanning figures/captions) separate runs of multi-column text."""
    if not lines:
        return []
    ls = sorted(lines, key=lambda l: (l.bbox[1], l.bbox[0]))
    full = [l for l in ls if (l.bbox[2] - l.bbox[0]) >= 0.62 * page_w]
    cols_all = detect_columns(ls, page_w, 0, page_h)
    if len(cols_all) == 1:
        return [(0.0, page_h, cols_all)]
    # a band boundary at every full-width line; consecutive non-full lines form a multi-column band
    bands = []
    cur_start = 0.0
    cur_has_text = False
    for l in ls:
        is_full = l in full or _crosses_gutter(l, cols_all)
        if is_full:
            if cur_has_text:
                bands.append((cur_start, l.bbox[1] - 0.5, None))
            bands.append((l.bbox[1] - 0.5, l.bbox[3] + 0.5, "full"))
            cur_start = l.bbox[3] + 0.5
            cur_has_text = False
        else:
            cur_has_text = True
    if cur_has_text:
        bands.append((cur_start, page_h, None))
    out = []
    for y0, y1, tag in bands:
        if tag == "full":
            out.append((y0, y1, [(min(l.bbox[0] for l in ls), max(l.bbox[2] for l in ls))]))
        else:
            sub = [l for l in ls if l.bbox[1] >= y0 - 1 and l.bbox[3] <= y1 + 1]
            out.append((y0, y1, detect_columns(sub, page_w, y0, y1)))
    # merge adjacent full-width bands
    merged = []
    for b in out:
        if merged and len(b[2]) == 1 and len(merged[-1][2]) == 1:
            merged[-1] = (merged[-1][0], b[1], [(min(merged[-1][2][0][0], b[2][0][0]), max(merged[-1][2][0][1], b[2][0][1]))])
        else:
            merged.append(b)
    return merged


def _crosses_gutter(l: Line, cols: List[Tuple[float, float]]) -> bool:
    if len(cols) < 2:
        return False
    for (a0, a1), (b0, b1) in zip(cols[:-1], cols[1:]):
        g = (a1 + b0) / 2
        if l.bbox[0] < g - 2 and l.bbox[2] > g + 2 and (l.bbox[2] - l.bbox[0]) > 0.35 * (cols[-1][1] - cols[0][0]):
            return True
    return False


# ----------------------------------------------------------------------------------- paragraphs
def _style_key(l: Line) -> Tuple[str, bool, bool, float]:
    s = max(l.spans, key=lambda s: len(s.text.strip()))
    return (s.font.split("-")[0], s.bold, s.italic, round(l.size))


def group_paragraphs(col_lines: List[Line], col_x: Tuple[float, float], body: float) -> List[Paragraph]:
    lines = sorted(col_lines, key=lambda l: (l.bbox[1], l.bbox[0]))
    paras: List[List[Line]] = []
    for l in lines:
        if not paras:
            paras.append([l]); continue
        prev = paras[-1][-1]
        gap = l.bbox[1] - prev.bbox[3]
        pitch = l.baseline - prev.baseline
        size = max(l.size, prev.size)
        same_style = _style_key(l)[3] == _style_key(prev)[3] and abs(l.size - prev.size) < 1.2
        starts_item = bool(_BULLET.match(l.text))
        indented = (l.bbox[0] - col_x[0]) > 0.9 * size and (prev.bbox[0] - col_x[0]) < 0.4 * size
        # a paragraph ends when the previous line is clearly short or the vertical gap is larger than normal leading
        prev_short = (col_x[1] - prev.bbox[2]) > 2.2 * size and len(paras[-1]) >= 1 and (col_x[1] - col_x[0]) > 12 * size
        newp = (gap > settings.para_gap_factor * size or pitch > 1.7 * size or not same_style or starts_item or indented
                or (prev_short and (l.bbox[0] - col_x[0]) < 0.5 * size and False))
        if prev_short and not starts_item and same_style and gap <= settings.para_gap_factor * size:
            newp = newp or False
        if newp:
            paras.append([l])
        else:
            paras[-1].append(l)
    return [_make_para(ls_, col_x, body) for ls_ in paras]


def _make_para(ls_: List[Line], col_x: Tuple[float, float], body: float) -> Paragraph:
    x0 = min(l.bbox[0] for l in ls_); y0 = min(l.bbox[1] for l in ls_)
    x1 = max(l.bbox[2] for l in ls_); y1 = max(l.bbox[3] for l in ls_)
    first = ls_[0]
    size = max(l.size for l in ls_)
    text = " ".join(l.text.strip() for l in ls_)
    all_bold = all(any(s.bold for s in l.spans if s.text.strip()) for l in ls_)
    kind, level = "para", 0
    marker = None
    m = _BULLET.match(first.text)
    if size >= body * 1.45 and len(text) < 220:
        kind, level = "heading", 1
    elif size >= body * 1.25 and len(text) < 220:
        kind, level = "heading", 2
    elif size >= body * 1.1 and (all_bold or len(text) < 90) and len(text) < 160:
        kind, level = "heading", 3
    elif all_bold and len(ls_) <= 2 and len(text) < 100 and not text.endswith((".", ",", ";")):
        kind, level = "heading", 3
    elif m:
        kind = "list"
        marker = m.group(1)
    pitch = 0.0
    if len(ls_) > 1:
        pitch = (ls_[-1].baseline - ls_[0].baseline) / (len(ls_) - 1)
    width = col_x[1] - col_x[0]
    left_pad = x0 - col_x[0]
    right_pad = col_x[1] - x1
    align = "left"
    centered = abs((x0 + x1) / 2 - (col_x[0] + col_x[1]) / 2) < 0.03 * width and left_pad > 0.06 * width
    if len(ls_) == 1:
        if centered:
            align = "center"
        elif right_pad < 0.03 * width and left_pad > 0.3 * width:
            align = "right"
    else:
        if centered and all(abs((l.bbox[0] + l.bbox[2]) / 2 - (x0 + x1) / 2) < 0.02 * width for l in ls_):
            align = "center"
        else:
            ends = [col_x[1] - l.bbox[2] for l in ls_[:-1]]
            if len(ls_) >= 3 and all(e < 0.025 * width + 1.0 for e in ends):
                align = "justify"
    left_edge = min(l.bbox[0] for l in ls_[1:]) if len(ls_) > 1 else x0
    return Paragraph(lines=ls_, bbox=(x0, y0, x1, y1), kind=kind, level=level, align=align, list_marker=marker,
                     indent_first=max(0.0, first.bbox[0] - left_edge) if len(ls_) > 1 else 0.0,
                     indent_left=max(0.0, left_edge - col_x[0]), line_pitch=pitch)


# ----------------------------------------------------------------------------------- math
def mark_math_regions(page: fitz.Page, lines: List[Line], exclude: Sequence[Tuple[float, float, float, float]] = ()) -> Tuple[List[Line], List[ImageBlock]]:
    """Lines dominated by mathematical glyphs, plus any neighbouring lines that overlap them vertically (fractions, sums,
    stacked limits), are rendered as images - Word cannot rebuild TeX math layout from plain text runs."""
    if not settings.render_math_as_image:
        return lines, []
    ex = [_rect(b) for b in exclude]
    all_lines = lines
    lines = [l for l in lines if not any((_rect(l.bbox) & e).get_area() > 0.5 * max(1.0, _rect(l.bbox).get_area()) for e in ex)]
    # display equations only: lines (almost) entirely mathematical, or carrying an equation number "(n)" next to math.
    # Inline math inside prose stays editable text (symbols, sub/superscripts are real runs).
    def display(l: Line) -> bool:
        t = l.text.strip()
        if re.search(r"[A-Za-z]{5,}", t) or len(t) > 70:
            return False                               # prose, even if it contains symbols
        return mathiness(l) >= 0.45 or (mathiness(l) >= 0.25 and len(t) < 40)
    flagged_all = [l for l in lines if display(l)]
    # equations typeset in ordinary fonts ("G = 10 log P,") are recognised by their equation number "(n)" at the right edge
    for num in [l for l in lines if re.fullmatch(r"\(\d+[a-z]?\)", l.text.strip())]:
        nr = _rect(num.bbox)
        for l in lines:
            if l in flagged_all or l is num:
                continue
            r = _rect(l.bbox)
            if r.x1 <= nr.x0 + 1 and abs((r.y0 + r.y1) / 2 - (nr.y0 + nr.y1) / 2) < 0.8 * max(r.height, nr.height)                     and not re.search(r"[A-Za-z]{5,}", l.text) and len(l.text) < 60:
                flagged_all.append(l)
        if num not in flagged_all and any(abs(_rect(f.bbox).y1 - nr.y1) < 12 for f in flagged_all):
            flagged_all.append(num)
    if not flagged_all:
        return lines, []
    rects = [_rect(l.bbox) for l in flagged_all]
    # grow: short fragments touching a math region (fraction bars' numerators, limits, "exp", commas, "10 log") belong to it
    changed = True
    while changed:
        changed = False
        for l in lines:
            if l in flagged_all:
                continue
            r = _rect(l.bbox)
            txt = l.text.strip()
            near = any(r.intersects(fitz.Rect(fr.x0 - 8, fr.y0 - 6, fr.x1 + 8, fr.y1 + 6)) for fr in rects)
            if near and len(txt) <= 14 and r.width < 90 and not re.search(r"[a-z]{4,}", txt):
                flagged_all.append(l); rects.append(r); changed = True
    # equation numbers "(n)" on the same baseline band join the equation (and extend its box to the right)
    for l in lines:
        if l in flagged_all:
            continue
        if re.fullmatch(r"\(\d+[a-z]?\)", l.text.strip()):
            r = _rect(l.bbox)
            if any(fr.y0 - 6 < (r.y0 + r.y1) / 2 < fr.y1 + 6 and r.x0 > fr.x0 for fr in rects):
                flagged_all.append(l); rects.append(r)
    clusters: List[fitz.Rect] = []
    for r in rects:
        placed = False
        for i, c in enumerate(clusters):
            if (r.y0 - c.y1 < 7 and c.y0 - r.y1 < 7 and r.x0 < c.x1 + 200 and c.x0 < r.x1 + 200) or c.intersects(r):
                clusters[i] = c | r; placed = True; break
        if not placed:
            clusters.append(fitz.Rect(r))
    merged_any = True
    while merged_any:
        merged_any = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                if clusters[i].intersects(clusters[j]):
                    clusters[i] |= clusters[j]; clusters.pop(j); merged_any = True; break
            if merged_any:
                break
    images: List[object] = []
    from . import omml
    for c in clusters:
        members = [l for l in flagged_all if _rect(l.bbox).intersects(c)]
        nums = [l for l in members if re.fullmatch(r"\(\d+[a-z]?\)", l.text.strip())]
        core = [l for l in members if l not in nums]
        if len(core) == 1 and len(nums) <= 1 and omml.is_single_baseline(core[0]) and omml.to_omath(core[0]) is not None and settings.omml_equations:
            images.append(MathBlock(bbox=(c.x0, c.y0, c.x1, c.y1), line=core[0], number=nums[0].text.strip() if nums else None))
            continue
        c = fitz.Rect(c.x0 - 2, c.y0 - 2, c.x1 + 2, c.y1 + 2) & page.rect
        png = page.get_pixmap(clip=c, dpi=300).tobytes("png")
        images.append(ImageBlock(bbox=(c.x0, c.y0, c.x1, c.y1), png=png, kind="math"))
    keep = [l for l in all_lines if l not in flagged_all]
    return keep, images


def merge_same_baseline(lines: List[Line]) -> List[Line]:
    """Fragments of one visual line (split earlier at wide gaps) that ended up in the same column cell are joined again,
    so justified text with stretched spaces is not torn into stacked pieces."""
    ls = sorted(lines, key=lambda l: (round(l.baseline), l.bbox[0]))
    out: List[Line] = []
    for l in ls:
        for o in out:
            if abs(o.baseline - l.baseline) < 0.35 * max(o.size, l.size) and l.bbox[0] >= o.bbox[2] - 1 and l.bbox[0] - o.bbox[2] < 4 * max(o.size, l.size):
                gap = l.bbox[0] - o.bbox[2]
                if gap > 0.15 * o.size and not o.text.endswith(" ") and not l.text.startswith(" "):
                    o.spans[-1] = Span(**{**o.spans[-1].__dict__, "text": o.spans[-1].text + " "})
                o.spans.extend(l.spans)
                o.bbox = (min(o.bbox[0], l.bbox[0]), min(o.bbox[1], l.bbox[1]), max(o.bbox[2], l.bbox[2]), max(o.bbox[3], l.bbox[3]))
                break
        else:
            out.append(Line(spans=list(l.spans), bbox=l.bbox, baseline=l.baseline))
    return out


def merge_drop_caps(lines: List[Line], body: float) -> List[Line]:
    """A very large 1-2 character line next to the start of a paragraph is a drop cap: fold it into the first text line to its right."""
    out = list(lines)
    for cap in [l for l in lines if len(l.text.strip()) <= 2 and l.size >= 2.2 * body]:
        cands = [l for l in out if l is not cap and l.bbox[0] >= cap.bbox[2] - 3 and l.bbox[0] - cap.bbox[2] < 25
                 and l.bbox[1] < cap.bbox[3] and l.bbox[3] > cap.bbox[1] and l.size < cap.size]
        if not cands:
            continue
        first = min(cands, key=lambda l: l.bbox[1])
        ref = first.spans[0]
        capspan = Span(text=cap.text.strip(), font=ref.font, size=ref.size, bold=ref.bold, italic=ref.italic, color=ref.color,
                       bbox=cap.bbox, origin=ref.origin)
        first.spans.insert(0, capspan)
        first.bbox = (min(first.bbox[0], cap.bbox[0]), first.bbox[1], first.bbox[2], first.bbox[3])
        out.remove(cap)
    return out


# ----------------------------------------------------------------------------------- page assembly
def build_page(index: int, page: fitz.Page, lines: List[Line], images: List[ImageBlock], tables: List[TableBlock],
               source: str, body: float, ocr_conf: Optional[float] = None) -> PageModel:
    W, H = page.rect.width, page.rect.height
    # remove text lines that live inside tables / figures
    def inside_any(l: Line, boxes) -> bool:
        lr = _rect(l.bbox)
        a = lr.get_area()
        return a > 0 and any((lr & _rect(b)).get_area() / a > 0.6 for b in boxes)
    lines = merge_drop_caps(lines, body)
    boxes = [t.bbox for t in tables] + [i.bbox for i in images if i.kind in ("figure", "math")]
    lines = [l for l in lines if not inside_any(l, boxes)]
    # images that merely repeat a figure region are dropped
    images = [i for i in images if i.kind != "image" or not any(_rect(b).contains(_rect(i.bbox)) for b in boxes)]
    pm = PageModel(index=index, width=W, height=H, source=source, ocr_conf=ocr_conf)
    objs: List[Tuple[Tuple[float, float, float, float], object]] = [(l.bbox, l) for l in lines]
    objs += [(i.bbox, i) for i in images] + [(t.bbox, t) for t in tables]
    if not objs:
        return pm
    text_lines = lines
    bands = split_bands(text_lines, W, H) if text_lines else [(0.0, H, [(0.0, W)])]
    # non-text objects (images/tables) force band boundaries as well
    block_objs = [(b, o) for b, o in objs if not isinstance(o, Line)]
    # Build bands: each band lists, per column, text paragraphs plus image/table blocks positioned by y
    band_models: List[Band] = []
    for y0, y1, cols in bands:
        band_models.append(Band(y0=y0, y1=y1, columns=cols, items=[[] for _ in cols]))
    if not band_models:
        band_models.append(Band(y0=0, y1=H, columns=[(0, W)], items=[[]]))

    def band_for(y):
        for bm in band_models:
            if bm.y0 - 0.5 <= y < bm.y1 + 0.5:
                return bm
        return min(band_models, key=lambda b: min(abs(b.y0 - y), abs(b.y1 - y)))

    def col_for(bm: Band, x0, x1):
        cx = (x0 + x1) / 2
        best = 0; bd = 1e9
        for i, (a, b) in enumerate(bm.columns):
            d = 0 if a - 1 <= cx <= b + 1 else min(abs(cx - a), abs(cx - b))
            if d < bd:
                best, bd = i, d
        return best

    per_cell: Dict[Tuple[int, int], List[Line]] = {}
    for l in text_lines:
        bm = band_for((l.bbox[1] + l.bbox[3]) / 2)
        c = col_for(bm, l.bbox[0], l.bbox[2]) if len(bm.columns) > 1 else 0
        per_cell.setdefault((band_models.index(bm), c), []).append(l)
    for key in list(per_cell):
        per_cell[key] = merge_same_baseline(per_cell[key])
    for (bi, c), ls_ in per_cell.items():
        bm = band_models[bi]
        for p in group_paragraphs(ls_, bm.columns[c], body):
            p.column = c
            bm.items[c].append(p)
    for b, o in block_objs:
        bm = band_for(b[1])
        c = col_for(bm, b[0], b[2]) if len(bm.columns) > 1 and (b[2] - b[0]) < 0.75 * W else 0
        if len(bm.columns) > 1 and (b[2] - b[0]) >= 0.75 * W:
            # a wide picture / table inside a multi-column band: give it its own full-width band
            new = Band(y0=b[1] - 0.5, y1=b[3] + 0.5, columns=[(0.0, W)], items=[[o]])
            band_models.append(new)
            continue
        bm.items[c].append(o)
    for bm in band_models:
        for col in bm.items:
            col.sort(key=lambda it: (it.bbox[1], it.bbox[0]))
    band_models.sort(key=lambda b: b.y0)
    # drop empty bands, merge nothing else
    pm.bands = [b for b in band_models if any(b.items)]
    # page margins from the text/object extents
    xs0 = [b[0] for b, _ in objs]; xs1 = [b[2] for b, _ in objs]; ys0 = [b[1] for b, _ in objs]; ys1 = [b[3] for b, _ in objs]
    pm.margins = (max(0.0, min(ys0)), max(0.0, W - max(xs1)), max(0.0, H - max(ys1)), max(0.0, min(xs0)))
    return pm


# ----------------------------------------------------------------------------------- headers / footers
def detect_headers_footers(pages: List[Tuple[PageModel, List[Line]]]) -> None:
    """A line is a header/footer when similar text (digits normalised) recurs in the top/bottom band on at least half of the
    pages (needs >= 3 pages) or when it is a bare page number. Detected lines are moved from the body to page.header/footer."""
    def norm(t: str) -> str:
        return re.sub(r"\d+", "#", t.strip().lower())
    n = len(pages)
    band = settings.header_footer_band
    top_c: Counter = Counter(); bot_c: Counter = Counter()
    for pm, lines in pages:
        for l in lines:
            ym = (l.bbox[1] + l.bbox[3]) / 2
            if ym < pm.height * band:
                top_c[norm(l.text)] += 1
            elif ym > pm.height * (1 - band):
                bot_c[norm(l.text)] += 1
    for pm, lines in pages:
        hdr, ftr = [], []
        for l in lines:
            ym = (l.bbox[1] + l.bbox[3]) / 2
            t = norm(l.text)
            is_num = bool(re.fullmatch(r"(page\s*)?#(\s*(of|/)\s*#)?", t))
            if ym < pm.height * band and ((n >= 3 and top_c[t] >= max(2, n // 2)) or (is_num and n >= 2)):
                hdr.append(l)
            elif ym > pm.height * (1 - band) and ((n >= 3 and bot_c[t] >= max(2, n // 2)) or (is_num and n >= 2)):
                ftr.append(l)
        pm.header, pm.footer = hdr, ftr


def strip_header_footer_lines(lines: List[Line], pm_header: List[Line], pm_footer: List[Line]) -> List[Line]:
    drop = {id(l) for l in pm_header + pm_footer}
    return [l for l in lines if id(l) not in drop]
