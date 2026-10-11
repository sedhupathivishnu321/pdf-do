"""FastAPI backend. Security model:
  * uploads are validated (extension, magic bytes, size, page count, encryption) and stored under random names in a private
    temp directory - client file names are never used on disk;
  * at most `max_concurrent_jobs` conversions run at once, each with a wall-clock timeout;
  * results and uploads are deleted automatically after `result_ttl_s` (and on explicit DELETE);
  * nothing is logged about document content; no network access is needed.
"""
from __future__ import annotations

import os
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

import fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from config import settings
from engine import ConversionOptions, convert_pdf
from engine.pipeline import ConversionError

app = FastAPI(title="PDF Do - PDF to DOCX", version="1.0")
os.makedirs(settings.temp_dir, exist_ok=True)
_executor = ThreadPoolExecutor(max_workers=settings.max_concurrent_jobs)
_jobs: Dict[str, dict] = {}
_lock = threading.Lock()
_ID = re.compile(r"^[0-9a-f]{32}$")


def _job_dir(job_id: str) -> str:
    if not _ID.match(job_id):
        raise HTTPException(404, "Unknown job")
    return os.path.join(settings.temp_dir, job_id)


def _get(job_id: str) -> dict:
    _job_dir(job_id)
    with _lock:
        j = _jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Unknown or expired job")
    return j


def _safe_name(name: Optional[str]) -> str:
    base = os.path.splitext(os.path.basename(name or "document"))[0]
    base = re.sub(r"[^\w\- .()]+", "_", base)[:80].strip() or "document"
    return base + ".docx"


def _delete(job_id: str):
    with _lock:
        _jobs.pop(job_id, None)
    shutil.rmtree(os.path.join(settings.temp_dir, job_id), ignore_errors=True)


def _cleanup_loop():
    while True:
        time.sleep(30)
        now = time.time()
        with _lock:
            old = [k for k, j in _jobs.items() if now - j["created"] > settings.result_ttl_s and j["status"] in ("done", "error")]
        for k in old:
            _delete(k)
        try:                                           # orphan directories (e.g. after a crash)
            for d in os.listdir(settings.temp_dir):
                p = os.path.join(settings.temp_dir, d)
                if _ID.match(d) and d not in _jobs and now - os.path.getmtime(p) > settings.result_ttl_s:
                    shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


threading.Thread(target=_cleanup_loop, daemon=True).start()


def _run(job_id: str, pdf: str, docx: str, opts: ConversionOptions):
    j = _jobs[job_id]
    j["status"] = "running"

    def prog(p, msg):
        j["progress"] = round(p, 3)
        j["message"] = msg
    result = {}

    def work():
        try:
            result["report"] = convert_pdf(pdf, docx, opts, prog)
        except Exception as e:                        # noqa: BLE001
            result["error"] = e
    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(settings.job_timeout_s)
    if th.is_alive():
        j["status"], j["error"] = "error", "The conversion timed out"
        return
    if "error" in result:
        e = result["error"]
        j["status"] = "error"
        j["error"] = str(e) if isinstance(e, ConversionError) else "The document could not be converted"
        return
    j["report"] = result["report"].to_dict()
    j["status"], j["progress"], j["message"] = "done", 1.0, "Done"


@app.post("/api/convert")
async def convert(file: UploadFile = File(...), ocr: str = Form("auto"), lang: str = Form("eng"),
                  pages: str = Form(""), mode: str = Form("layout"), math_as_image: bool = Form(True), tables: bool = Form(True)):
    if ocr not in ("auto", "always", "never"):
        raise HTTPException(400, "Invalid OCR mode")
    if mode not in ("editable", "layout"):
        raise HTTPException(400, "Invalid mode")
    if not re.fullmatch(r"[a-z]{3}(\+[a-z]{3})*", lang):
        raise HTTPException(400, "Invalid language code")
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only .pdf files are accepted")
    job_id = uuid.uuid4().hex
    d = _job_dir(job_id)
    os.makedirs(d, exist_ok=True)
    pdf, docx = os.path.join(d, "in.pdf"), os.path.join(d, "out.docx")
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    try:
        with open(pdf, "wb") as f:
            head = await file.read(5)
            if not head.startswith(b"%PDF-"):
                raise HTTPException(400, "The file is not a PDF")
            f.write(head)
            size += len(head)
            while True:
                chunk = await file.read(1 << 20)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, "File too large (limit %d MB)" % settings.max_upload_mb)
                f.write(chunk)
        try:
            doc = fitz.open(pdf)
            if doc.needs_pass:
                raise HTTPException(400, "Password-protected PDFs are not supported")
            n = doc.page_count
            doc.close()
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, "The file is not a valid PDF")
        if n > settings.max_pages:
            raise HTTPException(413, "Too many pages (limit %d)" % settings.max_pages)
        sel = None
        if pages.strip():
            try:
                sel = []
                for part in pages.split(","):
                    if "-" in part:
                        a, b = part.split("-")
                        sel += list(range(int(a) - 1, min(int(b), n)))
                    else:
                        sel.append(int(part) - 1)
            except ValueError:
                raise HTTPException(400, "Invalid page range")
    except HTTPException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    opts = ConversionOptions(ocr=ocr, ocr_lang=lang, pages=sel, mode=mode, math_as_image=math_as_image, detect_tables=tables)
    with _lock:
        _jobs[job_id] = {"status": "queued", "progress": 0.0, "message": "Queued", "created": time.time(),
                         "name": _safe_name(file.filename), "pages": n, "bytes": size}
    _executor.submit(_run, job_id, pdf, docx, opts)
    return {"job_id": job_id, "pages": n}


@app.get("/api/jobs/{job_id}")
def status(job_id: str):
    j = _get(job_id)
    return {k: v for k, v in j.items() if k in ("status", "progress", "message", "error", "report", "name", "pages")}


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    j = _get(job_id)
    if j["status"] != "done":
        raise HTTPException(409, "The conversion is not finished")
    return FileResponse(os.path.join(_job_dir(job_id), "out.docx"), filename=j["name"],
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/api/jobs/{job_id}/preview/{page}")
def preview(job_id: str, page: int, kind: str = "source"):
    """PNG preview of an uploaded page; kind=layout overlays the detected structure (paragraphs, tables, figures)."""
    _get(job_id)
    pdf = os.path.join(_job_dir(job_id), "in.pdf")
    if not os.path.exists(pdf):
        raise HTTPException(404, "Preview no longer available")
    doc = fitz.open(pdf)
    try:
        if page < 1 or page > doc.page_count:
            raise HTTPException(404, "No such page")
        pg = doc[page - 1]
        if kind == "layout":
            from engine import analysis, layout
            lines = analysis.extract_lines(pg)
            body = layout.body_font_size(lines)
            tabs = analysis.extract_tables(pg)
            lines2, math_imgs = layout.mark_math_regions(pg, lines, [t.bbox for t in tabs])
            pm = layout.build_page(page - 1, pg, lines2, analysis.extract_images(pg, doc) + math_imgs, tabs, "native", body)
            shape = pg.new_shape()
            palette = {"Paragraph": (0.2, 0.4, 1), "ImageBlock": (0.1, 0.7, 0.3), "TableBlock": (0.9, 0.5, 0.1)}
            for b in pm.bands:
                for col in b.items:
                    for it in col:
                        shape.draw_rect(fitz.Rect(*it.bbox))
                        shape.finish(color=palette.get(type(it).__name__, (1, 0, 0)), width=0.9)
            shape.commit()
        png = pg.get_pixmap(dpi=90).tobytes("png")
    finally:
        doc.close()
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.delete("/api/jobs/{job_id}")
def remove(job_id: str):
    _get(job_id)
    _delete(job_id)
    return {"deleted": True}


@app.get("/api/health")
def health():
    from engine import ocr
    return {"ok": True, "ocr": ocr.ocr_available(), "limits": {"max_upload_mb": settings.max_upload_mb, "max_pages": settings.max_pages}}


app.mount("/", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"), html=True), name="static")
