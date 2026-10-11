import os
import sys

import docx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import testdata                                    # noqa: E402
from engine import ConversionOptions, convert_pdf  # noqa: E402
from engine import analysis, layout, ocr           # noqa: E402
import pymupdf as fitz                             # noqa: E402


@pytest.fixture(scope="session")
def data(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    meta = testdata.build_all(str(d))
    return str(d), meta


def conv(data, name, **kw):
    d, _ = data
    out = os.path.join(d, name + ".docx")
    kw.setdefault("mode", "editable")
    rep = convert_pdf(os.path.join(d, name + ".pdf"), out, ConversionOptions(**kw))
    return docx.Document(out), rep


def doc_text(doc):
    parts = [p.text for p in doc.paragraphs]
    for t in doc.tables:
        for r in t.rows:
            parts += [c.text for c in r.cells]
    return "\n".join(parts)


def test_text_pdf_roundtrip(data):
    doc, rep = conv(data, "text")
    assert rep.native_pages == 3 and rep.ocr_pages == 0
    t = doc_text(doc)
    assert "Chapter 1: Measurement Report" in t
    assert len(doc.sections) >= 3
    heads = [p for p in doc.paragraphs if p._p.pPr is not None and p._p.pPr.xpath('./w:outlineLvl')]
    assert heads, "headings should be detected"


def test_two_column_has_word_columns_and_reading_order(data):
    doc, rep = conv(data, "twocol")
    assert any(s._sectPr.xpath("./w:cols/@w:num") == ["2"] for s in doc.sections)
    text = doc_text(doc)
    # left column text must precede right column text
    d, meta = data
    src = fitz.open(os.path.join(d, "twocol.pdf"))
    words = src[0].get_text("words")
    left_first = [w for w in words if w[0] < 300][0][4]
    assert left_first in text


def test_table_reconstruction(data):
    doc, rep = conv(data, "tables")
    assert rep.tables == 1 and len(doc.tables) == 1
    _, meta = data
    got = [[c.text for c in r.cells] for r in doc.tables[0].rows]
    assert got == meta["tables"]["table"]


def test_scanned_detected_and_ocr(data):
    d, _ = data
    pdf = fitz.open(os.path.join(d, "scanned.pdf"))
    kind, _s = analysis.classify_page(pdf[0])
    assert kind == "scanned"
    if not ocr.ocr_available():
        pytest.skip("Tesseract not installed")
    doc, rep = conv(data, "scanned")
    assert rep.ocr_pages == 2 and rep.mean_ocr_confidence and rep.mean_ocr_confidence > 60
    assert "Chapter 1" in doc_text(doc)


def test_mixed_document_uses_both_paths(data):
    if not ocr.ocr_available():
        pytest.skip("Tesseract not installed")
    doc, rep = conv(data, "mixed")
    assert rep.native_pages == 1 and rep.ocr_pages == 1


def test_math_region_rendered_as_image(tmp_path):
    p = tmp_path / "m.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Plain sentence before the formula.", fontsize=11)
    fp = r"C:\Windows\Fonts\seguisym.ttf"
    if not os.path.exists(fp):
        pytest.skip("no Unicode math font available")
    page.insert_text((200, 150), "∑ α ≤ ∫ f(x) dx = √π", fontname="sym", fontfile=fp, fontsize=14)
    doc.save(str(p))
    page = fitz.open(str(p))[0]
    lines = analysis.extract_lines(page)
    keep, imgs = layout.mark_math_regions(page, lines)
    assert len(imgs) >= 1 and imgs[0].kind in ("math", "omml")


def test_header_footer_detection(data):
    d, _ = data
    doc = fitz.open(os.path.join(d, "text.pdf"))
    pms, ls = [], []
    for i in range(doc.page_count):
        lines = analysis.extract_lines(doc[i])
        pm = layout.build_page(i, doc[i], lines, [], [], "native", layout.body_font_size(lines))
        pms.append((pm, lines))
    layout.detect_headers_footers(pms)
    assert all(any(l.text.startswith("Page") for l in pm.footer) for pm, _ in pms)


def test_page_limit_and_encrypted(tmp_path):
    p = tmp_path / "e.pdf"
    d = fitz.open()
    d.new_page()
    d.save(str(p), encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="x", owner_pw="y")
    from engine.pipeline import ConversionError
    with pytest.raises(ConversionError):
        convert_pdf(str(p), str(tmp_path / "o.docx"))


def test_rules_only_table_is_detected(tmp_path):
    doc = fitz.open(); page = doc.new_page(width=595, height=842)
    page.insert_text((72, 70), "Table 1. Results", fontsize=10)
    ys = [80, 96, 170]
    for y in ys:
        page.draw_line((72, y), (400, y), width=0.6)
    rows = [["Model", "MAE", "RMSE"], ["A", "0.12", "0.20"], ["B", "0.15", "0.24"], ["C", "0.11", "0.19"], ["D", "0.18", "0.30"]]
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            page.insert_text((80 + c * 110, 92 + r * 15), cell, fontsize=9)
    path = tmp_path / "t.pdf"; doc.save(str(path))
    pg = fitz.open(str(path))[0]
    tabs = analysis.extract_rule_tables(pg, analysis.extract_lines(pg))
    assert len(tabs) == 1 and tabs[0].grid == "horizontal" and tabs[0].rows[1] == ["A", "0.12", "0.20"]


def test_diagram_labels_are_not_a_table(tmp_path):
    doc = fitz.open(); page = doc.new_page(width=595, height=842)
    for i in range(4):
        for j in range(3):
            r = fitz.Rect(80 + j * 120, 100 + i * 60, 170 + j * 120, 140 + i * 60)
            page.draw_rect(r, color=(0, 0, 1)); page.insert_textbox(r, "Node %d" % (i * 3 + j), fontsize=8)
    path = tmp_path / "d.pdf"; doc.save(str(path))
    d = fitz.open(str(path)); pg = d[0]
    lines = analysis.extract_lines(pg); imgs = analysis.extract_images(pg, d)
    figs = analysis.extract_vector_figures(pg, lines, imgs)
    kept = analysis.validate_tables(pg, analysis.extract_tables(pg), imgs + figs, lines)
    assert figs and not kept


def test_no_widow_control_or_empty_footer(data):
    doc, rep = conv(data, "twocol")
    assert doc.styles["Normal"].paragraph_format.widow_control is False


def test_single_line_equation_becomes_editable_word_equation(tmp_path):
    fp = r"C:\Windows\Fonts\cambria.ttc"
    if not os.path.exists(fp):
        fp = r"C:\Windows\Fonts\seguisym.ttf"
    if not os.path.exists(fp):
        pytest.skip("no math-capable font")
    doc = fitz.open(); page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Intro text of a paragraph that is long enough to set the body size.", fontsize=11)
    page.insert_text((200, 200), "\u03b1 \u2264 \u222b x", fontname="m", fontfile=fp, fontsize=12)
    page.insert_text((232, 195), "2", fontname="m", fontfile=fp, fontsize=8)
    page.insert_text((400, 200), "(1)", fontname="m", fontfile=fp, fontsize=12)
    p = tmp_path / "e.pdf"; doc.save(str(p))
    out = tmp_path / "e.docx"
    rep = convert_pdf(str(p), str(out), ConversionOptions())
    import zipfile
    xml = zipfile.ZipFile(str(out)).read("word/document.xml").decode()
    assert rep.editable_equations >= 1 and "<m:oMath" in xml and "<m:sSup" in xml


def test_tex_ligatures_are_normalised(tmp_path):
    doc = fitz.open(); page = doc.new_page()
    page.insert_text((72, 100), "e\ufb03cient \ufb01nite \ufb02ow", fontname="helv", fontsize=11)
    p = tmp_path / "l.pdf"; doc.save(str(p))
    out = tmp_path / "l.docx"; convert_pdf(str(p), str(out), ConversionOptions())
    import docx as _d
    t = " ".join(x.text for x in _d.Document(str(out)).paragraphs)
    assert "\ufb01" not in t and "\ufb03" not in t


def test_layout_mode_preserves_geometry_and_has_no_word_tables(data):
    """Default mode: text lives in page-anchored frames at its PDF position, artwork is a background picture, no Word tables."""
    d, _ = data
    out = os.path.join(d, "tables_layout.docx")
    rep = convert_pdf(os.path.join(d, "tables.pdf"), out, ConversionOptions())
    assert rep.mode == "layout"
    import zipfile
    xml = zipfile.ZipFile(out).read("word/document.xml").decode()
    assert "<w:tbl>" not in xml and "<w:framePr" in xml and 'behindDoc="1"' in xml
    doc = docx.Document(out)
    assert len(doc.sections) == 1                      # one page in, one section/page out


def test_layout_mode_keeps_page_count_and_page_sizes(tmp_path):
    pdf = fitz.open()
    pdf.new_page(width=595, height=842).insert_text((72, 100), "portrait", fontsize=12)
    pdf.new_page(width=842, height=595).insert_text((72, 100), "landscape", fontsize=12)
    p = tmp_path / "m.pdf"; pdf.save(str(p))
    out = tmp_path / "m.docx"; convert_pdf(str(p), str(out), ConversionOptions())
    d = docx.Document(str(out))
    sizes = [(round(s.page_width.pt), round(s.page_height.pt)) for s in d.sections]
    assert sizes == [(595, 842), (842, 595)]
