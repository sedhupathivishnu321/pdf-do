"""Stage 2 - OCR for scanned pages: preprocessing (grayscale, denoise, deskew, binarise, orientation fix) + Tesseract
with word-level confidence. Output uses the same Line/Span model as native extraction so layout analysis is shared."""
from __future__ import annotations

import io
import math
from typing import List, Optional, Tuple

import cv2
import fitz
import numpy as np

from config import settings
from .models import Line, Span


class OCRUnavailable(RuntimeError):
    pass


def _tess():
    try:
        import pytesseract
    except Exception as e:  # pragma: no cover
        raise OCRUnavailable("pytesseract is not installed") from e
    if not settings.tesseract_cmd:
        raise OCRUnavailable("Tesseract executable not found (install it or set PDF2DOCX_TESSERACT)")
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
    return pytesseract


def ocr_available() -> bool:
    try:
        _tess().get_tesseract_version()
        return True
    except Exception:
        return False


def render_page(page: fitz.Page, dpi: int) -> np.ndarray:
    pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()


def estimate_skew(gray: np.ndarray) -> float:
    """Skew angle in degrees (positive = text rotated counter-clockwise), via minAreaRect of the ink pixels on a downscaled copy."""
    scale = 800.0 / max(gray.shape)
    small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray
    _, bw = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    bw = cv2.dilate(bw, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 1)), iterations=1)   # join letters into text lines
    pts = cv2.findNonZero(bw)
    if pts is None or len(pts) < 200:
        return 0.0
    # projection-profile search is more robust than minAreaRect for text pages
    best, best_score = 0.0, -1.0
    h, w = bw.shape
    for ang in np.arange(-8, 8.01, 0.5):
        M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
        rot = cv2.warpAffine(bw, M, (w, h), flags=cv2.INTER_NEAREST)
        prof = rot.sum(axis=1).astype(np.float64)
        score = float(np.var(prof))
        if score > best_score:
            best, best_score = float(ang), score
    return best


def rotate_keep(gray: np.ndarray, angle: float) -> np.ndarray:
    if abs(angle) < 0.15:
        return gray
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def preprocess(gray: np.ndarray, do_denoise=True, do_deskew=True, do_binarize=True) -> Tuple[np.ndarray, float]:
    """Return (image for OCR, deskew angle applied)."""
    img = gray
    angle = 0.0
    if do_denoise:
        img = cv2.fastNlMeansDenoising(img, None, h=10, templateWindowSize=7, searchWindowSize=21)
    if do_deskew:
        angle = estimate_skew(img)
        img = rotate_keep(img, angle)
    if do_binarize:
        # local contrast normalisation then adaptive threshold (robust against uneven scan lighting)
        bg = cv2.medianBlur(img, 31)
        norm = cv2.divide(img, bg, scale=255)
        img = cv2.adaptiveThreshold(norm, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 15)
    return img, angle


def detect_orientation(img: np.ndarray) -> int:
    """Return rotation (0/90/180/270) that must be applied clockwise to make the text upright (Tesseract OSD)."""
    try:
        t = _tess()
        osd = t.image_to_osd(img, output_type=t.Output.DICT, config="--psm 0 -c min_characters_to_try=20")
        if float(osd.get("orientation_conf", 0)) >= 2.0:
            return int(osd.get("rotate", 0)) % 360
    except Exception:
        pass
    return 0


def ocr_page(page: fitz.Page, lang: Optional[str] = None, dpi: Optional[int] = None,
             denoise=True, deskew=True, binarize=True) -> Tuple[List[Line], float, dict]:
    """OCR one PDF page. Returns (lines in PDF points, mean word confidence, info)."""
    t = _tess()
    dpi = dpi or settings.ocr_dpi
    gray = render_page(page, dpi)
    info = {"dpi": dpi}
    rot = detect_orientation(gray)
    if rot:
        gray = np.ascontiguousarray(np.rot90(gray, k=(4 - rot // 90) % 4))
        info["orientation_fixed"] = rot
    img, angle = preprocess(gray, denoise, deskew, binarize)
    info["deskew_deg"] = round(angle, 2)
    data = t.image_to_data(img, lang=lang or settings.ocr_lang, config="--psm 3", output_type=t.Output.DICT)
    k = 72.0 / dpi
    H = img.shape[0]
    cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    cx, cy = img.shape[1] / 2, H / 2

    def unrotate(x, y):
        """Map a point from the deskewed image back to the original (un-deskewed) page image."""
        dx, dy = x - cx, y - cy
        return cx + dx * cos - dy * sin, cy + dx * sin + dy * cos
    groups = {}
    confs: List[float] = []
    for i, txt in enumerate(data["text"]):
        txt = (txt or "").strip()
        if not txt:
            continue
        conf = float(data["conf"][i])
        if conf < settings.ocr_min_conf:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        if abs(angle) > 0.15:
            x0, y0 = unrotate(x, y)
            x1, y1 = unrotate(x + w, y + h)
            x, y, w, h = min(x0, x1), min(y0, y1), abs(x1 - x0), abs(y1 - y0)
        groups.setdefault(key, []).append((x, y, w, h, txt, conf))
        confs.append(conf)
    lines: List[Line] = []
    for key, words in sorted(groups.items()):
        words.sort(key=lambda a: a[0])
        size = max(6.0, float(np.median([w[3] for w in words])) * k / 0.72)   # glyph box height ~0.72 em
        spans = []
        for j, (x, y, w, h, txt, conf) in enumerate(words):
            bb = (x * k, y * k, (x + w) * k, (y + h) * k)
            spans.append(Span(text=txt + (" " if j < len(words) - 1 else ""), font="Times New Roman", size=round(size, 1),
                              bbox=bb, origin=(bb[0], bb[3]), conf=conf))
        x0 = min(s.bbox[0] for s in spans); y0 = min(s.bbox[1] for s in spans)
        x1 = max(s.bbox[2] for s in spans); y1 = max(s.bbox[3] for s in spans)
        lines.append(Line(spans=spans, bbox=(x0, y0, x1, y1), baseline=y1))
    mean_conf = float(np.mean(confs)) if confs else 0.0
    info["words"] = len(confs)
    return lines, mean_conf, info
