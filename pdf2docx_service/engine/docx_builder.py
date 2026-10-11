"""Stage 4 - DOCX reconstruction with python-docx. Custom XML is used only where python-docx has no API:
hyperlinks, continuous section breaks with multiple columns, exact line spacing and per-cell widths."""
from __future__ import annotations

import io
import os
import re
from typing import List, Optional

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu, Pt, RGBColor

from .models import Band, ImageBlock, Line, MathBlock, PageModel, Paragraph, Span, TableBlock

_FONT_MAP = {
    "nimbusromno9l": "Times New Roman", "nimbusrom": "Times New Roman", "times": "Times New Roman", "timesnewroman": "Times New Roman",
    "timesnewromanps": "Times New Roman", "liberationserif": "Times New Roman", "cmr": "Times New Roman", "cmbx": "Times New Roman",
    "cmti": "Times New Roman", "ptmr": "Times New Roman", "stix": "Times New Roman", "libertine": "Times New Roman",
    "nimbussanl": "Arial", "helvetica": "Arial", "arial": "Arial", "liberationsans": "Arial", "cmss": "Arial", "phvr": "Arial",
    "nimbusmon": "Courier New", "courier": "Courier New", "cmtt": "Courier New", "liberationmono": "Courier New",
    "calibri": "Calibri", "cambria": "Cambria", "verdana": "Verdana", "tahoma": "Tahoma", "georgia": "Georgia",
    "segoeui": "Segoe UI", "consolas": "Consolas", "garamond": "Garamond", "palatino": "Palatino Linotype",
    "symbol": "Symbol", "trebuchetms": "Trebuchet MS",
}
_WORD_FONTS = set(_FONT_MAP.values()) | {"Courier New", "Comic Sans MS", "Century Gothic", "Candara", "Corbel", "Constantia"}


def word_font(name: str, kind: str = "") -> str:
    base = re.split(r"[-,]", name)[0]
    key = re.sub(r"[^a-z]", "", base.lower())
    key = re.sub(r"(psmt|ps|mt)$", "", key)
    for k, v in _FONT_MAP.items():
        if key.startswith(k):
            return v
    nice = re.sub(r"([a-z])([A-Z])", r"\1 \2", base).strip()
    if nice in _WORD_FONTS:
        return nice
    if re.search(r"mono|courier|consol", name, re.I) or kind == "mono":
        return "Courier New"
    if re.search(r"sans|arial|helv|gothic|verdana|tahoma|calibri|roboto|open|noto|segoe|lato|inter|ubuntu|source|poppins|montserrat", name, re.I) or kind == "sans":
        return "Arial"
    return "Times New Roman"


# calibration measured with Word (median word offset of rendered frames vs the PDF): Word draws frame text slightly left / high
FRAME_DX = float(os.environ.get('PDF2DOCX_FRAME_DX', '0'))
FRAME_DY = float(os.environ.get('PDF2DOCX_FRAME_DY', '0'))
_xml_bad = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _add_run(p, sp: Span, link_rid=None):
    text = _xml_bad.sub("", sp.text)
    for lig, rpl in (("\ufb00", "ff"), ("\ufb01", "fi"), ("\ufb02", "fl"), ("\ufb03", "ffi"), ("\ufb04", "ffl"), ("\ufb05", "st"), ("\ufb06", "st")):
        text = text.replace(lig, rpl)
    text = re.sub(r"[-]", lambda m: "•" if m.group() == "" else chr(ord(m.group()) - 0xF000), text)
    if not text:
        return None
    run = p.add_run(text)
    f = run.font
    f.name = word_font(sp.font, sp.kind)
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts"); rpr.insert(0, rfonts)
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(a), f.name)
    f.size = Pt(max(1.0, round(sp.size * 2) / 2))
    f.bold = True if sp.bold else None
    f.italic = True if sp.italic else None
    if sp.superscript:
        f.superscript = True
    elif sp.subscript:
        f.subscript = True
    if sp.color and sp.color != 0:
        f.color.rgb = RGBColor((sp.color >> 16) & 255, (sp.color >> 8) & 255, sp.color & 255)
    if sp.underline or sp.link:
        f.underline = True
    return run


def _add_hyperlink(par, uri: str, spans: List[Span]):
    part = par.part
    rid = part.relate_to(uri, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    h = OxmlElement("w:hyperlink")
    h.set(qn("r:id"), rid)
    tmp = par._parent.add_paragraph() if False else None
    for sp in spans:
        run = _add_run(par, sp)
        if run is None:
            continue
        run.font.color.rgb = RGBColor(0x05, 0x63, 0xC1)
        par._p.remove(run._r)
        h.append(run._r)
    par._p.append(h)


def _fill_paragraph(par, lines: List[Line]):
    """Add the spans of all lines. Consecutive spans sharing a hyperlink are wrapped in one w:hyperlink element; the line breaks
    of the original are *not* kept (Word re-flows) except the hyphen join of TeX-style line-end hyphenation."""
    spans_all: List[Span] = []
    for i, ln in enumerate(lines):
        sps = [Span(**{**s.__dict__}) for s in ln.spans]
        if i < len(lines) - 1 and sps:
            last = sps[-1]
            nxt = lines[i + 1].spans[0].text if lines[i + 1].spans else ""
            if re.search(r"[A-Za-z]-$", last.text.rstrip()) and re.match(r"[a-z]", nxt):
                last.text = last.text.rstrip()[:-1]
            elif not last.text.endswith(" "):
                last.text += " "
        spans_all.extend(sps)
    group: List[Span] = []
    cur_link = None
    for sp in spans_all + [None]:
        link = sp.link if sp else None
        if sp is None or link != cur_link:
            if group:
                if cur_link:
                    _add_hyperlink(par, cur_link, group)
                else:
                    for g in group:
                        _add_run(par, g)
            group, cur_link = [], link
        if sp is not None:
            group.append(sp)


def _set_exact_spacing(par, pitch_pt: float, before_pt: float, rule="atLeast"):
    pf = par.paragraph_format
    pf.space_before = Pt(max(0.0, min(before_pt, 400)))
    pf.space_after = Pt(0)
    if pitch_pt > 0:
        pf.line_spacing = Pt(pitch_pt)
        pf.line_spacing_rule = WD_LINE_SPACING.AT_LEAST if rule == "atLeast" else WD_LINE_SPACING.EXACTLY


_ALIGN = {"left": WD_ALIGN_PARAGRAPH.LEFT, "center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT, "justify": WD_ALIGN_PARAGRAPH.JUSTIFY}


def _set_columns(section, columns):
    sectPr = section._sectPr
    for old in sectPr.findall(qn("w:cols")):
        sectPr.remove(old)
    cols = OxmlElement("w:cols")
    n = len(columns)
    cols.set(qn("w:num"), str(n))
    if n > 1:
        cols.set(qn("w:equalWidth"), "0")
        for i, (a, b) in enumerate(columns):
            c = OxmlElement("w:col")
            c.set(qn("w:w"), str(int(round((b - a + 3) * 20))))
            if i < n - 1:
                c.set(qn("w:space"), str(int(round(max(2.0, columns[i + 1][0] - b - 3) * 20))))
            cols.append(c)
    sectPr.append(cols)


def _set_type(section, kind):
    sectPr = section._sectPr
    for old in sectPr.findall(qn("w:type")):
        sectPr.remove(old)
    t = OxmlElement("w:type"); t.set(qn("w:val"), kind)
    sectPr.insert(0, t)


class Builder:
    def __init__(self):
        self.doc = Document()
        st = self.doc.styles["Normal"]
        st.paragraph_format.space_after = Pt(0)
        st.paragraph_format.space_before = Pt(0)
        st.paragraph_format.widow_control = False      # Word must not move lines to the next page: positions follow the PDF
        st.paragraph_format.keep_together = False
        self._first = True
        # drop the empty first paragraph python-docx creates
        body = self.doc.element.body
        for p in list(body.findall(qn("w:p"))):
            body.remove(p)

    # ------------------------------------------------------------------ sections
    def _new_section(self, pm: PageModel, columns, continuous: bool):
        if self._first:
            sec = self.doc.sections[0]
            self._first = False
            continuous = False
        else:
            sec = self.doc.add_section(WD_SECTION.CONTINUOUS if continuous else WD_SECTION.NEW_PAGE)
        sec.page_width = Pt(pm.width); sec.page_height = Pt(pm.height)
        top, right, bottom, left = pm.margins
        slack = 2.0 if len(columns) == 1 else 4.0
        sec.top_margin = Pt(max(8, top)); sec.bottom_margin = Pt(max(0, min(bottom, pm.height * 0.4) - 48))
        sec.left_margin = Pt(max(0, left - slack)); sec.right_margin = Pt(max(0, right - slack))
        sec.header_distance = Pt(max(4, top / 3)); sec.footer_distance = Pt(max(4, bottom / 3))
        _set_type(sec, "continuous" if continuous else "nextPage")
        _set_columns(sec, columns)
        return sec

    def _header_footer(self, sec, pm: PageModel, first_page: bool):
        for kind, lines in (("header", pm.header), ("footer", pm.footer)):
            if not lines:
                continue                      # an empty header/footer would still reserve vertical space
            part = getattr(sec, kind)
            part.is_linked_to_previous = False
            if lines:
                p = part.paragraphs[0]
                for i, ln in enumerate(lines):
                    pp = p if i == 0 else part.add_paragraph()
                    _fill_paragraph(pp, [ln])
                    mid = (ln.bbox[0] + ln.bbox[2]) / 2
                    pp.alignment = WD_ALIGN_PARAGRAPH.CENTER if abs(mid - pm.width / 2) < pm.width * 0.12 else (WD_ALIGN_PARAGRAPH.RIGHT if mid > pm.width * 0.6 else WD_ALIGN_PARAGRAPH.LEFT)

    # ------------------------------------------------------------------ content
    def add_page(self, pm: PageModel, page_no: int, total: int):
        bands = pm.bands or [Band(0, pm.height, [(0, pm.width)], [[]])]
        cursor = max(8.0, pm.margins[0])
        for bi, band in enumerate(bands):
            continuous = bi > 0
            sec = self._new_section(pm, band.columns, continuous)
            if bi == 0:
                self._header_footer(sec, pm, True)
            first_in_band = True
            band_end = cursor
            for ci, col in enumerate(band.items):
                ccursor = max(cursor, band.y0) if not first_in_band else cursor
                ccursor = cursor
                for item in col:
                    ccursor = self._emit(item, band, ci, ccursor, pm)
                band_end = max(band_end, ccursor)
                if len(band.columns) > 1 and any(band.items[cj] for cj in range(ci + 1, len(band.items))) and col:
                    self._column_break()
                first_in_band = False
            cursor = band_end
        # a final empty paragraph carries the section properties of the page's last band (python-docx handles it)

    # ------------------------------------------------------------------ Mode B: layout-preserved
    @staticmethod
    def _anchor_inline(inline, x, y, behind=False):
        """Turn a python-docx inline picture into a page-anchored floating picture (wrapNone) at absolute x,y (points)."""
        from lxml import etree
        WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        parent = inline.getparent()
        anchor = etree.SubElement(parent, "{%s}anchor" % WP, nsmap=inline.nsmap)
        for k, v in (("distT", "0"), ("distB", "0"), ("distL", "0"), ("distR", "0"), ("simplePos", "0"), ("relativeHeight", "251658240"),
                     ("behindDoc", "1" if behind else "0"), ("locked", "0"), ("layoutInCell", "1"), ("allowOverlap", "1")):
            anchor.set(k, v)
        sp = etree.SubElement(anchor, "{%s}simplePos" % WP); sp.set("x", "0"); sp.set("y", "0")
        for tag, val in (("positionH", x), ("positionV", y)):
            e = etree.SubElement(anchor, "{%s}%s" % (WP, tag)); e.set("relativeFrom", "page")
            off = etree.SubElement(e, "{%s}posOffset" % WP); off.text = str(int(val * 12700))
        kids = list(inline)
        for child in kids:
            if child.tag.endswith("}extent"):
                anchor.append(child)
        eff = etree.SubElement(anchor, "{%s}effectExtent" % WP)
        for a in ("l", "t", "r", "b"):
            eff.set(a, "0")
        etree.SubElement(anchor, "{%s}wrapNone" % WP)
        for child in kids:
            if not child.tag.endswith("}extent"):
                anchor.append(child)
        parent.remove(inline)

    def add_page_layout(self, pm: PageModel):
        """Every line / picture / table is placed at its original absolute position (frames + anchored pictures)."""
        sec = self._new_section(pm, [(0, pm.width)], False)
        sec.top_margin = Pt(0); sec.bottom_margin = Pt(0); sec.left_margin = Pt(0); sec.right_margin = Pt(0)
        sec.header_distance = Pt(0); sec.footer_distance = Pt(0)
        items = []
        for b in pm.bands:
            for col in b.items:
                items.extend(col)
        lines = list(pm.header) + list(pm.footer)
        import os as _os
        variant = "D"        # opener paragraph, floating tables, then the picture-anchor paragraph (Word drops anchors placed before a floating table)
        carrier = None
        bg = pm.background_img
        if variant in ("A", "D"):
            opener = self.doc.add_paragraph(); _set_exact_spacing(opener, 1, 0, "exact")
            if variant == "A":
                carrier = opener
        for it in items:
            if isinstance(it, TableBlock):
                self._float_table(it)
        if variant in ("B", "D"):
            carrier = self.doc.add_paragraph(); _set_exact_spacing(carrier, 1, 0, "exact")
        if bg:
            rb = carrier.add_run(); rb.font.size = Pt(1)
            rb.add_picture(io.BytesIO(bg), width=Pt(pm.width), height=Pt(pm.height))
            self._anchor_inline(rb._r.xpath(".//wp:inline")[0], 0, 0, behind=True)
        for it in items:
            if isinstance(it, ImageBlock):
                x0, y0, x1, y1 = it.bbox
                if variant == "C":
                    carrier = self.doc.add_paragraph(); _set_exact_spacing(carrier, 1, 0, "exact")
                r = carrier.add_run(); r.font.size = Pt(1)
                r.add_picture(io.BytesIO(it.png), width=Pt(x1 - x0), height=Pt(y1 - y0))
                self._anchor_inline(r._r.xpath(".//wp:inline")[0], x0, y0)
            elif isinstance(it, Paragraph):
                lines.extend(it.lines)
            elif isinstance(it, MathBlock):
                self._frame_equation(it, pm)
        # a line is 'justified' when it reaches the right edge shared by the other lines that start at the same x (a text column)
        cols = {}
        for ln in lines:
            cols.setdefault(round(ln.bbox[0] / 6), []).append(ln.bbox[2])
        for ln in lines:
            right = max(cols[round(ln.bbox[0] / 6)])
            full = len(cols[round(ln.bbox[0] / 6)]) >= 4 and ln.bbox[2] >= right - 1.5 and (ln.bbox[2] - ln.bbox[0]) > 0.5 * (right - min(l.bbox[0] for l in lines if round(l.bbox[0] / 6) == round(ln.bbox[0] / 6)))
            self._frame_line(ln, pm, justify=full)

    def _frame_equation(self, mb: MathBlock, pm):
        from . import omml
        par = self.doc.add_paragraph()
        x0, y0, x1, y1 = mb.bbox
        lx0, ly0, lx1, ly1 = mb.line.bbox
        h = max(mb.line.size * 1.4, ly1 - ly0 + 2)
        w = min(pm.width - lx0 - 0.5, (lx1 - lx0) * 1.15 + 6)
        top = mb.line.baseline - 0.78 * h
        pPr = par._p.get_or_add_pPr()
        fr = OxmlElement("w:framePr")
        for k, v in (("w:w", int(w * 20)), ("w:h", int(h * 20)), ("w:hRule", "atLeast"), ("w:hSpace", 0), ("w:vSpace", 0), ("w:wrap", "none"),
                     ("w:vAnchor", "page"), ("w:hAnchor", "page"), ("w:x", int(lx0 * 20)), ("w:y", int(max(0, top) * 20))):
            fr.set(qn(k), str(v))
        pPr.insert(0, fr)
        par.paragraph_format.space_before = Pt(0); par.paragraph_format.space_after = Pt(0)
        par._p.append(omml.to_omath(mb.line))
        if mb.number:
            nl = Line(spans=[Span(text=mb.number, font="Times New Roman", size=mb.line.size, bbox=(x1 - 24, y0, x1, y1), origin=(x1 - 24, mb.line.baseline))],
                      bbox=(x1 - 24, y0, x1, y1), baseline=mb.line.baseline)
            self._frame_line(nl, pm)

    @staticmethod
    def _natural_width(ln) -> float:
        """Width Word will give the line, measured with metric-compatible base-14 fonts (Tiro~Times New Roman, Helv~Arial)."""
        import pymupdf
        total = 0.0
        for sp in ln.spans:
            fam = word_font(sp.font, sp.kind)
            base = {"Arial": "hel", "Courier New": "cou"}.get(fam, "tim")
            key = {"hel": ("helv", "hebo", "heit", "hebi"), "cou": ("cour", "cobo", "coit", "cobi"), "tim": ("tiro", "tibo", "tiit", "tibi")}[base]
            fn = key[(1 if sp.bold else 0) + (2 if sp.italic else 0)] if not (sp.bold and sp.italic) else key[3]
            try:
                total += pymupdf.get_text_length(sp.text, fontname=fn, fontsize=(sp.size * (0.65 if (sp.superscript or sp.subscript) else 1.0)))
            except Exception:
                total += len(sp.text) * sp.size * 0.5
        return total

    def _frame_line(self, ln, pm, justify=False):
        par = self.doc.add_paragraph()
        _fill_paragraph(par, [ln])
        h = ln.size * 1.2
        x0, y0, x1, y1 = ln.bbox
        target = x1 - x0
        w = min(pm.width - x0 - 0.5, target * 1.06 + 3)
        nat = self._natural_width(ln)
        nchars = max(1, sum(len(r.text) for r in par.runs))
        safe_font = all(word_font(sp.font, sp.kind) in ("Times New Roman", "Arial", "Courier New", "Cambria") for sp in ln.spans)
        delta = target - nat
        if nat > 0 and abs(delta) > 0.25 and abs(delta) < 0.25 * target:
            if delta > 0 and justify and safe_font:
                w = target + 0.4
                par.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
                par.add_run().add_break()          # a manual break makes Word justify this single line to the frame width
            else:
                # character spacing (twentieths of a point) fits the line to its exact original width
                sp_pt = max(-1.2, min(1.2, delta / nchars))
                for r in par.runs:
                    rpr = r._r.get_or_add_rPr()
                    e = OxmlElement("w:spacing"); e.set(qn("w:val"), str(int(round(sp_pt * 20)))); rpr.append(e)
                w = max(w, target + 6)
        top = ln.baseline - 0.8 * h
        pPr = par._p.get_or_add_pPr()
        fr = OxmlElement("w:framePr")
        for k, v in (("w:w", int(w * 20)), ("w:h", int(h * 20)), ("w:hRule", "exact"), ("w:hSpace", 0), ("w:vSpace", 0), ("w:wrap", "none"),
                     ("w:vAnchor", "page"), ("w:hAnchor", "page"), ("w:x", int((x0 + FRAME_DX) * 20)), ("w:y", int(max(0, top + FRAME_DY) * 20))):
            fr.set(qn(k), str(v))
        pPr.insert(0, fr)
        pf = par.paragraph_format
        pf.space_before = Pt(0); pf.space_after = Pt(0)
        pf.line_spacing = Pt(h); pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY

    def _float_table(self, t):
        self._table(t, (t.bbox[0], t.bbox[2]), t.bbox[1])
        tbl = self.doc.tables[-1]
        pr = OxmlElement("w:tblpPr")
        for k, v in (("w:leftFromText", 0), ("w:rightFromText", 0), ("w:vertAnchor", "page"), ("w:horzAnchor", "page"),
                     ("w:tblpX", int(t.bbox[0] * 20)), ("w:tblpY", int(t.bbox[1] * 20))):
            pr.set(qn(k), str(v))
        tbl._tbl.tblPr.insert(0, pr)
        prev = tbl._tbl.getprevious()
        if prev is not None and prev.tag == qn("w:p") and not prev.findall(qn("w:r")):
            prev.getparent().remove(prev)

    def _column_break(self):
        """End the current column: a column-break run in a 1 pt paragraph (never inside a table)."""
        from docx.enum.text import WD_BREAK
        par = self.doc.add_paragraph()
        _set_exact_spacing(par, 1, 0, "exact")
        r = par.add_run(); r.font.size = Pt(1)
        r.add_break(WD_BREAK.COLUMN)

    def _emit(self, item, band: Band, ci: int, cursor: float, pm: PageModel) -> float:
        colx = band.columns[ci] if ci < len(band.columns) else band.columns[0]
        if isinstance(item, Paragraph):
            return self._paragraph(item, colx, cursor)
        if isinstance(item, ImageBlock):
            return self._image(item, colx, cursor)
        if isinstance(item, TableBlock):
            return self._table(item, colx, cursor)
        if isinstance(item, MathBlock):
            return self._equation(item, colx, cursor)
        return cursor

    def _paragraph(self, p: Paragraph, colx, cursor: float) -> float:
        par = self.doc.add_paragraph()
        _fill_paragraph(par, p.lines)
        size = p.lines[0].size
        pitch = (p.line_pitch or size * 1.2) * 0.985     # 1.5 % tighter: absorbs Word wrap/rounding differences so columns do not spill a line
        top = p.lines[0].baseline - 0.8 * pitch          # Word puts the baseline ~80 % down an exact-height line
        before = max(0.0, (top - cursor - 0.4) * 0.96)   # slightly compressed gaps: Word must never spill the last line onto a new page
        _set_exact_spacing(par, pitch, before, "exact")
        par.alignment = _ALIGN.get(p.align, WD_ALIGN_PARAGRAPH.LEFT)
        pf = par.paragraph_format
        if p.align in ("left", "justify"):
            pf.left_indent = Pt(p.indent_left if len(p.lines) > 1 else max(0.0, p.bbox[0] - colx[0]))
            if p.indent_first > 0.5:
                pf.first_line_indent = Pt(p.indent_first)
        if p.kind == "heading":
            self._style_heading(par, p)
        return max(cursor, top) + pitch * len(p.lines)

    def _style_heading(self, par, p: Paragraph):
        pPr = par._p.get_or_add_pPr()
        lvl = OxmlElement("w:outlineLvl"); lvl.set(qn("w:val"), str(max(0, p.level - 1)))
        pPr.append(lvl)
        # restore run formatting (style change must not recolour/resize the text)
        for run, sp in zip(par.runs, [s for l in p.lines for s in l.spans]):
            run.font.size = Pt(max(1.0, round(sp.size * 2) / 2))
            run.font.name = word_font(sp.font, sp.kind)
            run.font.color.rgb = RGBColor((sp.color >> 16) & 255, (sp.color >> 8) & 255, sp.color & 255)
            run.font.bold = True if sp.bold else None
            run.font.italic = True if sp.italic else None

    def _equation(self, mb: MathBlock, colx, cursor: float, frame=None) -> float:
        """Display equation: centred editable OMML with the equation number on a right tab (one paragraph)."""
        from . import omml
        om = omml.to_omath(mb.line)
        par = self.doc.add_paragraph()
        x0, y0, x1, y1 = mb.bbox
        size = mb.line.size
        pitch = max(size * 1.45, (y1 - y0))
        pPr = par._p.get_or_add_pPr()
        width = max(40.0, colx[1] - colx[0])
        tabs = OxmlElement("w:tabs")
        for val, pos in (("center", width / 2), ("right", width)):
            t = OxmlElement("w:tab"); t.set(qn("w:val"), val); t.set(qn("w:pos"), str(int(pos * 20))); tabs.append(t)
        pPr.append(tabs)
        pf = par.paragraph_format
        before = max(0.0, y0 - cursor - 0.4)
        pf.space_before = Pt(min(before, 400)); pf.space_after = Pt(0)
        pf.line_spacing = Pt(pitch); pf.line_spacing_rule = WD_LINE_SPACING.AT_LEAST
        par.add_run().add_tab()
        par._p.append(om)
        if mb.number:
            r = par.add_run(); r.add_tab(); r2 = par.add_run(mb.number)
            r2.font.size = Pt(max(1.0, round(size * 2) / 2)); r2.font.name = "Times New Roman"
        for run in par.runs:
            run.font.size = Pt(max(1.0, round(size * 2) / 2))
        return max(cursor, y1)

    def _image(self, im: ImageBlock, colx, cursor: float) -> float:
        par = self.doc.add_paragraph()
        x0, y0, x1, y1 = im.bbox
        w, h = x1 - x0, y1 - y0
        avail = colx[1] - colx[0] + 6
        scale = min(1.0, avail / w) if w > avail else 1.0
        run = par.add_run()
        run.font.size = Pt(1)                       # a tiny font keeps the line box == picture height (no descent padding)
        ppr_rpr = OxmlElement("w:rPr"); sz = OxmlElement("w:sz"); sz.set(qn("w:val"), "2"); ppr_rpr.append(sz); par._p.get_or_add_pPr().append(ppr_rpr)
        run.add_picture(io.BytesIO(im.png), width=Pt(w * scale), height=Pt(h * scale))
        cx = (x0 + x1) / 2
        mid = (colx[0] + colx[1]) / 2
        if abs(cx - mid) < 0.06 * (colx[1] - colx[0]):
            par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        else:
            par.paragraph_format.left_indent = Pt(max(0.0, x0 - colx[0]))
        _set_exact_spacing(par, h * scale, max(0.0, y0 - cursor - 0.4), "atLeast")
        return max(cursor, y1)

    def _table(self, t: TableBlock, colx, cursor: float) -> float:
        rows, ncols = t.rows, max(len(r) for r in t.rows)
        tbl = self.doc.add_table(rows=len(rows), cols=ncols)
        if t.grid == "full":
            tbl.style = "Table Grid"
        tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
        tbl.autofit = False
        avail = max(60.0, colx[1] - colx[0] + 6)
        total_w = min(t.bbox[2] - t.bbox[0], avail)
        widths = t.col_widths if len(t.col_widths) == ncols else [(t.bbox[2] - t.bbox[0]) / ncols] * ncols
        k = total_w / max(1.0, sum(widths))
        widths = [w * k for w in widths]
        # fixed layout + explicit grid so Word does not re-autofit the columns
        tblPr = tbl._tbl.tblPr
        lay = OxmlElement("w:tblLayout"); lay.set(qn("w:type"), "fixed"); tblPr.append(lay)
        mar = OxmlElement("w:tblCellMar")
        for side, v in (("top", 15), ("left", 40), ("bottom", 15), ("right", 40)):
            e = OxmlElement("w:" + side); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa"); mar.append(e)
        tblPr.append(mar)
        for gc, w in zip(tbl._tbl.tblGrid.findall(qn("w:gridCol")), widths):
            gc.set(qn("w:w"), str(int(w * 20)))
        fs = Pt(t.font_size)
        for ri, r in enumerate(rows):
            for ci in range(ncols):
                cell = tbl.cell(ri, ci)
                cell.width = Pt(widths[ci])
                txt = r[ci] if ci < len(r) else ""
                para = cell.paragraphs[0]
                pf = para.paragraph_format
                pf.space_before = Pt(0); pf.space_after = Pt(0)
                pf.line_spacing_rule = WD_LINE_SPACING.SINGLE
                al = t.aligns[ci] if ci < len(t.aligns) else "left"
                para.alignment = WD_ALIGN_PARAGRAPH.RIGHT if (al == "right" and ri > 0) else WD_ALIGN_PARAGRAPH.LEFT
                run = para.add_run(txt)
                run.font.size = fs
                run.font.name = "Times New Roman"
                if ri < t.header_rows and t.header and t.grid == "full":
                    run.font.bold = True
                if t.grid == "horizontal":
                    self._cell_borders(cell, top=(ri == 0), bottom=(ri == len(rows) - 1 or ri == t.header_rows - 1))
        gap = max(0.0, t.bbox[1] - cursor)
        if gap > 2:
            spacer = self.doc.add_paragraph()
            _set_exact_spacing(spacer, 1, gap, "exact")
            tbl._tbl.addprevious(spacer._p)
        return max(cursor, t.bbox[3])

    @staticmethod
    def _cell_borders(cell, top=False, bottom=False):
        tcPr = cell._tc.get_or_add_tcPr()
        b = OxmlElement("w:tcBorders")
        for side, on in (("top", top), ("bottom", bottom)):
            if on:
                e = OxmlElement("w:" + side); e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "6"); e.set(qn("w:color"), "000000"); b.append(e)
        tcPr.append(b)

    def _shrink_section_paragraphs(self):
        """python-docx puts each section break in an empty 11 pt paragraph; at a page bottom that paragraph overflows onto a
        blank page. Make them 1 pt high."""
        for p in self.doc.element.body.iter(qn("w:p")):
            pPr = p.find(qn("w:pPr"))
            if pPr is not None and pPr.find(qn("w:sectPr")) is not None and not p.findall(qn("w:r")):
                sp = pPr.find(qn("w:spacing"))
                if sp is None:
                    sp = OxmlElement("w:spacing"); pPr.insert(0, sp)
                for k, v in (("w:before", "0"), ("w:after", "0"), ("w:line", "20"), ("w:lineRule", "exact")):
                    sp.set(qn(k), v)
                rpr = OxmlElement("w:rPr"); sz = OxmlElement("w:sz"); sz.set(qn("w:val"), "2"); rpr.append(sz)
                pPr.insert(list(pPr).index(pPr.find(qn("w:sectPr"))), rpr)

    def save(self, path):
        self._shrink_section_paragraphs()
        self.doc.core_properties.author = "PDF Do"
        self.doc.core_properties.comments = "Converted by PDF Do pdf2docx_service"
        self.doc.save(path)


def build_docx(pages: List[PageModel], out_path: str, progress=None, mode: str = "editable"):
    b = Builder()
    n = len(pages)
    for i, pm in enumerate(pages):
        if mode == "layout":
            b.add_page_layout(pm)
        else:
            b.add_page(pm, i, n)
        if progress:
            progress(i + 1, n)
    b.save(out_path)
