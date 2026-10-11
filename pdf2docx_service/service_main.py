"""Entry point used by the PDF Do desktop launcher (and PyInstaller). Starts the FastAPI service on 127.0.0.1 only.

  service_main.py --port 8765 --token SECRET

Every /api request must carry the header  X-PDFDo-Token: SECRET  (so other programs or web pages on this PC cannot use the
service). CORS is limited to the file:// origin of the bundled UI. Temp files live under %LOCALAPPDATA%\\PDFDo\\tmp."""
import argparse
import os
import sys


def _base_dir():
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def _setup_environment():
    exe_dir = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
    tess = os.path.join(exe_dir, "tesseract", "tesseract.exe")
    if os.path.exists(tess):
        os.environ.setdefault("PDF2DOCX_TESSERACT", tess)
        os.environ.setdefault("TESSDATA_PREFIX", os.path.join(exe_dir, "tesseract", "tessdata"))
    local = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    os.environ.setdefault("PDF2DOCX_TEMP_DIR", os.path.join(local, "PDFDo", "tmp"))
    os.environ.setdefault("PDF2DOCX_MAX_UPLOAD_MB", "200")
    os.environ.setdefault("PDF2DOCX_MAX_PAGES", "500")
    os.environ.setdefault("PDF2DOCX_RESULT_TTL_S", "1800")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--token", required=True)
    a = ap.parse_args()
    _setup_environment()
    sys.path.insert(0, _base_dir())
    from fastapi import Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from app.main import app
    import uvicorn

    @app.middleware("http")
    async def _auth(request: Request, call_next):
        if request.method != "OPTIONS" and request.url.path.startswith("/api") and request.headers.get("x-pdfdo-token") != a.token \
                and request.query_params.get("tok") != a.token:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=["null", "file://"], allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
                       allow_headers=["x-pdfdo-token", "content-type"], expose_headers=["content-disposition"])
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
