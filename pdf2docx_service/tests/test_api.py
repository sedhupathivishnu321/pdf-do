import io
import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymupdf as fitz                  # noqa: E402
from app.main import app                # noqa: E402
from config import settings             # noqa: E402

client = TestClient(app)


def tiny_pdf(n=1):
    d = fitz.open()
    for i in range(n):
        d.new_page().insert_text((72, 100), "Hello page %d" % i)
    return d.tobytes()


def wait(job):
    for _ in range(100):
        s = client.get("/api/jobs/" + job).json()
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.2)
    raise AssertionError("timeout")


def test_health():
    assert client.get("/api/health").json()["ok"]


def test_convert_download_and_delete():
    r = client.post("/api/convert", files={"file": ("my doc.pdf", tiny_pdf(), "application/pdf")})
    assert r.status_code == 200
    job = r.json()["job_id"]
    s = wait(job)
    assert s["status"] == "done" and s["report"]["pages"] == 1
    d = client.get("/api/jobs/%s/download" % job)
    assert d.status_code == 200 and d.content[:2] == b"PK"
    assert client.get("/api/jobs/%s/preview/1" % job).headers["content-type"] == "image/png"
    assert client.delete("/api/jobs/" + job).status_code == 200
    assert client.get("/api/jobs/" + job).status_code == 404
    assert not os.path.exists(os.path.join(settings.temp_dir, job))


def test_rejects_non_pdf_and_bad_extension():
    assert client.post("/api/convert", files={"file": ("a.pdf", b"not a pdf at all", "application/pdf")}).status_code == 400
    assert client.post("/api/convert", files={"file": ("a.txt", tiny_pdf(), "text/plain")}).status_code == 400


def test_rejects_oversize(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    r = client.post("/api/convert", files={"file": ("a.pdf", tiny_pdf(), "application/pdf")})
    assert r.status_code == 413


def test_rejects_too_many_pages(monkeypatch):
    monkeypatch.setattr(settings, "max_pages", 2)
    r = client.post("/api/convert", files={"file": ("a.pdf", tiny_pdf(3), "application/pdf")})
    assert r.status_code == 413


def test_job_id_validation_blocks_path_traversal():
    assert client.get("/api/jobs/..%2f..%2fetc/download").status_code in (404, 422)
    assert client.get("/api/jobs/not-a-job/download").status_code == 404


def test_invalid_options():
    assert client.post("/api/convert", data={"ocr": "x"}, files={"file": ("a.pdf", tiny_pdf(), "application/pdf")}).status_code == 400
    assert client.post("/api/convert", data={"lang": "../../x"}, files={"file": ("a.pdf", tiny_pdf(), "application/pdf")}).status_code == 400
