"""Editable Word equations (OMML) for single-baseline equations typeset by TeX/LaTeX.

A TeX display equation that has no stacked parts (no fractions, big-operator limits, matrices) is one baseline of glyph runs:
main-size runs plus smaller raised / lowered runs (scripts). That maps cleanly to <m:oMath> with <m:sSup>/<m:sSub>/<m:sSubSup>.
Anything stacked is left to the picture fallback (never silently dropped)."""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from lxml import etree

from .models import Line, Span

M = "http://schemas.openxmlformats.org/officeDocument/2006/math"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSMAP = {"m": M, "w": W}
_UPRIGHT_FONT = re.compile(r"cmr|cmbx|cmss|cmtt|times|nimbusrom|arial|helvet|msbm|cmex", re.I)
_FUNCS = ("log", "exp", "ln", "max", "min", "sin", "cos", "tan", "arg", "det", "lim", "sup", "inf", "mod")


def _m(tag, parent=None, **attrs):
    e = etree.Element("{%s}%s" % (M, tag), nsmap=NSMAP) if parent is None else etree.SubElement(parent, "{%s}%s" % (M, tag))
    for k, v in attrs.items():
        e.set("{%s}%s" % (M, k), v)
    return e


def _run(parent, text: str, upright: bool):
    r = _m("r", parent)
    if upright:
        rpr = _m("rPr", r)
        _m("sty", rpr, val="p")
    t = _m("t", r)
    t.text = text
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return r


def _is_script(sp: Span, msize: float) -> int:
    if sp.superscript:
        return 1
    if sp.subscript:
        return -1
    return 0


def to_omath(line: Line) -> Optional[etree._Element]:
    """Return an <m:oMath> for the line or None when it is not a safe single-baseline equation."""
    spans = [s for s in line.spans if s.text.strip() or s.text == " "]
    if not spans:
        return None
    msize = max(s.size for s in spans)
    # tokens: (kind, text, upright)   kind in n|sup|sub
    toks: List[list] = []
    for s in spans:
        k = _is_script(s, msize)
        text = re.sub(r"[-]", lambda mo: chr(ord(mo.group()) - 0xF000) if mo.group() != "" else "•", s.text)
        text = text.replace("−", "−").replace("∗", "*")
        up = bool(_UPRIGHT_FONT.search(s.font)) and not re.search(r"cmmi|cmsy|mathit", s.font, re.I)
        toks.append(["sup" if k > 0 else "sub" if k < 0 else "n", text, up])
    if all(t[0] != "n" for t in toks):
        return None
    om = _m("oMath")
    i = 0
    cur_text: List[Tuple[str, bool]] = []

    def flush(parent):
        for text, up in cur_text:
            if text:
                _run(parent, text, up)
        cur_text.clear()

    while i < len(toks):
        kind, text, up = toks[i]
        if kind == "n":
            cur_text.append((text, up))
            i += 1
            continue
        # script: attaches to the last character of the preceding normal text
        base = ""
        base_up = True
        if cur_text and cur_text[-1][0]:
            lt, base_up = cur_text[-1]
            stripped = lt.rstrip()
            trailing = lt[len(stripped):]
            base = stripped[-1:] if stripped else ""
            cur_text[-1] = (stripped[:-1], base_up)
            if trailing:
                cur_text.append((trailing, base_up))
        flush(om)
        sup_t = sub_t = None
        j = i
        while j < len(toks) and toks[j][0] in ("sup", "sub"):
            if toks[j][0] == "sup":
                sup_t = (sup_t or "") + toks[j][1]
            else:
                sub_t = (sub_t or "") + toks[j][1]
            j += 1
        if sup_t and sub_t:
            node = _m("sSubSup", om)
        elif sup_t:
            node = _m("sSup", om)
        else:
            node = _m("sSub", om)
        _m("sSupPr", node) if False else None
        e = _m("e", node)
        if base:
            _run(e, base, base_up)
        else:
            _run(e, "​", True)
        if sub_t:
            _run(_m("sub", node), sub_t.strip(), up)
        if sup_t:
            _run(_m("sup", node), sup_t.strip(), up)
        i = j
    flush(om)
    # upright function names
    return om


def is_single_baseline(line: Line) -> bool:
    """True when every span sits on the line's baseline or is a clear script of it (no stacked fraction parts)."""
    if not line.spans:
        return False
    msize = max(s.size for s in line.spans)
    base = max(line.spans, key=lambda s: (s.size, len(s.text.strip()))).origin[1]
    for s in line.spans:
        if abs(s.origin[1] - base) > 0.5 * msize:
            return False
    return True
