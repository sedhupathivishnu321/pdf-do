"""Data model shared by all pipeline stages. All geometry is in PDF points, origin top-left (PyMuPDF convention)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

BBox = Tuple[float, float, float, float]  # x0, y0, x1, y1


@dataclass
class Span:
    text: str
    font: str
    size: float
    bold: bool = False
    italic: bool = False
    underline: bool = False
    color: int = 0                      # 0xRRGGBB
    bbox: BBox = (0, 0, 0, 0)
    origin: Tuple[float, float] = (0, 0)
    link: Optional[str] = None          # external URI
    conf: Optional[float] = None        # OCR confidence 0..100 (None for native text)
    superscript: bool = False
    subscript: bool = False
    kind: str = ""                      # font class hint from the PDF flags: serif | sans | mono


@dataclass
class Line:
    spans: List[Span]
    bbox: BBox
    baseline: float = 0.0

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans)

    @property
    def size(self) -> float:
        sizes = [s.size for s in self.spans if s.text.strip()]
        return max(sizes) if sizes else 10.0


@dataclass
class ImageBlock:
    bbox: BBox
    png: bytes
    kind: str = "image"                 # image | figure (vector drawing) | math


@dataclass
class MathBlock:
    """A single-baseline display equation rebuilt as an editable Word equation (OMML)."""
    bbox: BBox
    line: Line
    number: Optional[str] = None
    kind: str = "omml"


@dataclass
class TableBlock:
    bbox: BBox
    rows: List[List[str]]
    col_widths: List[float] = field(default_factory=list)
    row_heights: List[float] = field(default_factory=list)
    header: bool = False
    font_size: float = 9.5
    aligns: List[str] = field(default_factory=list)
    grid: str = "full"                  # full | horizontal (rules only)
    header_rows: int = 1


@dataclass
class Paragraph:
    lines: List[Line]
    bbox: BBox
    kind: str = "para"                  # para | heading | list
    level: int = 0                      # heading level 1..3
    align: str = "left"                 # left | center | right | justify
    list_marker: Optional[str] = None
    indent_first: float = 0.0
    indent_left: float = 0.0
    space_before: float = 0.0
    line_pitch: float = 0.0
    column: int = 0

    @property
    def text(self) -> str:
        return " ".join(l.text.strip() for l in self.lines)


@dataclass
class Band:
    """A horizontal slice of the page that has a fixed number of columns (1 = full width)."""
    y0: float
    y1: float
    columns: List[Tuple[float, float]]                      # x-ranges of the columns
    items: List[List[object]] = field(default_factory=list)  # items[c] = ordered blocks of column c


@dataclass
class PageModel:
    index: int
    width: float
    height: float
    source: str                          # native | ocr
    bands: List[Band] = field(default_factory=list)
    header: List[Line] = field(default_factory=list)
    footer: List[Line] = field(default_factory=list)
    margins: Tuple[float, float, float, float] = (54, 54, 54, 54)   # top, right, bottom, left
    ocr_conf: Optional[float] = None
    warnings: List[str] = field(default_factory=list)
    background_img: Optional[bytes] = None
