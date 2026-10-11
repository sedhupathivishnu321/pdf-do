"""Synthetic, copyright-free test documents with known ground truth. Generated with PyMuPDF so every result is reproducible.
Categories: text (single column), twocol, tables, scanned (rasterised + noise + skew), mixed (text page + scanned page)."""
from __future__ import annotations

import os
import random
from typing import Dict, List

import cv2
import numpy as np
import pymupdf as fitz

LOREM = ("The quick brown fox jumps over the lazy dog while engineers measure acoustic channels near the harbour. "
         "Reliable conversion preserves paragraphs, headings, lists and tables so that documents remain editable. "
         "Forecasting adaptive links requires careful evaluation of delay spread, gain and noise across several sites. ").split()


def _words(rng: random.Random, n: int) -> str:
    return " ".join(rng.choice(LOREM) for _ in range(n))


def _para(rng, n):
    s = _words(rng, n)
    return s[0].upper() + s[1:] + "."


def make_text(path: str, pages: int = 3, seed: int = 1) -> Dict:
    rng = random.Random(seed)
    doc = fitz.open()
    truth: List[str] = []
    for p in range(pages):
        page = doc.new_page(width=595, height=842)
        y = 70
        title = "Chapter %d: Measurement Report" % (p + 1)
        page.insert_text((72, y), title, fontname="hebo", fontsize=20)
        truth.append(title)
        y += 34
        for k in range(4):
            txt = _para(rng, 60)
            rc = fitz.Rect(72, y, 523, y + 120)
            page.insert_textbox(rc, txt, fontname="tiro", fontsize=11, align=fitz.TEXT_ALIGN_JUSTIFY)
            truth.append(txt)
            y += 112
        page.insert_text((72, 810), "Page %d" % (p + 1), fontname="helv", fontsize=9)
    doc.save(path)
    return {"text": "\n".join(truth), "kind": "text"}


def make_twocol(path: str, pages: int = 2, seed: int = 2) -> Dict:
    rng = random.Random(seed)
    doc = fitz.open()
    truth: List[str] = []
    for p in range(pages):
        page = doc.new_page(width=595, height=842)
        t = "A Two-Column Study %d" % (p + 1)
        page.insert_textbox(fitz.Rect(40, 40, 555, 80), t, fontname="hebo", fontsize=20, align=fitz.TEXT_ALIGN_CENTER)
        truth.append(t)
        for c, x in enumerate((40, 310)):
            y = 100
            for k in range(5):
                txt = _para(rng, 45)
                page.insert_textbox(fitz.Rect(x, y, x + 245, y + 140), txt, fontname="tiro", fontsize=10, align=fitz.TEXT_ALIGN_JUSTIFY)
                truth.append(txt)
                y += 138
    doc.save(path)
    # ground-truth reading order: title, then left column, then right column (as inserted)
    return {"text": "\n".join(truth), "kind": "twocol"}


def make_tables(path: str, seed: int = 3) -> Dict:
    rng = random.Random(seed)
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 70), "Table of measurements", fontname="hebo", fontsize=16)
    rows = [["Site", "Region", "Depth (m)", "Temp (C)"]]
    for i in range(7):
        rows.append(["S%02d" % i, rng.choice(["North", "South", "East", "West"]), str(rng.randint(5, 900)), "%.1f" % rng.uniform(2, 28)])
    x0, y0, cw, rh = 72, 100, [90, 140, 110, 110], 24
    for r, row in enumerate(rows):
        x = x0
        for c, cell in enumerate(row):
            rect = fitz.Rect(x, y0 + r * rh, x + cw[c], y0 + (r + 1) * rh)
            page.draw_rect(rect, color=(0, 0, 0), width=0.7)
            page.insert_text((x + 5, y0 + r * rh + 16), cell, fontname="hebo" if r == 0 else "helv", fontsize=10)
            x += cw[c]
    page.insert_text((72, y0 + len(rows) * rh + 30), "Values are synthetic.", fontname="tiit", fontsize=10)
    doc.save(path)
    return {"kind": "tables", "table": rows, "text": "Table of measurements\n" + "\n".join(" ".join(r) for r in rows) + "\nValues are synthetic."}


def _scan(page_png: np.ndarray, seed: int, skew: float = 1.2) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = page_png.astype(np.float32)
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), skew, 1.0)
    img = cv2.warpAffine(img, M, (w, h), borderValue=255)
    img = cv2.GaussianBlur(img, (3, 3), 0.8)
    img += rng.normal(0, 9, img.shape)
    gx = np.linspace(0.88, 1.0, w)[None, :]
    img = img * gx
    return np.clip(img, 0, 255).astype(np.uint8)


def make_scanned(path: str, src_text_pdf: str, pages: int = 2, seed: int = 4) -> Dict:
    """Rasterise a text PDF at 200 dpi, add skew/blur/noise/uneven lighting, and embed the images only (no text layer)."""
    src = fitz.open(src_text_pdf)
    truth_doc = src
    doc = fitz.open()
    for i in range(min(pages, src.page_count)):
        pix = src[i].get_pixmap(dpi=200, colorspace=fitz.csGRAY)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
        arr = _scan(arr, seed + i)
        ok, enc = cv2.imencode(".png", arr)
        page = doc.new_page(width=src[i].rect.width, height=src[i].rect.height)
        page.insert_image(page.rect, stream=enc.tobytes())
    doc.save(path)
    text = "\n".join(src[i].get_text("text") for i in range(min(pages, src.page_count)))
    return {"kind": "scanned", "text": text}


def make_mixed(path: str, text_pdf: str, scanned_pdf: str) -> Dict:
    a, b = fitz.open(text_pdf), fitz.open(scanned_pdf)
    doc = fitz.open()
    doc.insert_pdf(a, from_page=0, to_page=0)
    doc.insert_pdf(b, from_page=0, to_page=0)
    doc.save(path)
    return {"kind": "mixed", "text": a[0].get_text("text") + "\n" + b[0].get_text("text") if b[0].get_text("text").strip() else a[0].get_text("text")}


def build_all(out_dir: str) -> Dict[str, Dict]:
    os.makedirs(out_dir, exist_ok=True)
    meta = {}
    p = lambda n: os.path.join(out_dir, n)
    meta["text"] = make_text(p("text.pdf"))
    meta["twocol"] = make_twocol(p("twocol.pdf"))
    meta["tables"] = make_tables(p("tables.pdf"))
    # the scanned source keeps its own ground truth text (taken from the vector PDF)
    meta["scanned"] = make_scanned(p("scanned.pdf"), p("text.pdf"), pages=2)
    scanned_text = meta["scanned"]["text"]
    meta["mixed"] = make_mixed(p("mixed.pdf"), p("text.pdf"), p("scanned.pdf"))
    first_page_text = fitz.open(p("text.pdf"))[0].get_text("text")
    # mixed ground truth: native page text + the text of the page that was scanned (text.pdf page 1)
    meta["mixed"]["text"] = first_page_text + "\n" + first_page_text
    return meta


if __name__ == "__main__":
    import sys
    print(build_all(sys.argv[1] if len(sys.argv) > 1 else "data").keys())
