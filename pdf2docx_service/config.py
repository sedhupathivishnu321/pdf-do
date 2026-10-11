"""Central configuration. Every value can be overridden with an environment variable PDF2DOCX_<NAME>."""
import os
import shutil
from dataclasses import dataclass, field


def _env(name, default, cast=str):
    v = os.environ.get("PDF2DOCX_" + name)
    return cast(v) if v is not None else default


def _find_tesseract():
    p = os.environ.get("PDF2DOCX_TESSERACT") or shutil.which("tesseract")
    if p:
        return p
    for c in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe", "/usr/bin/tesseract", "/usr/local/bin/tesseract"):
        if os.path.exists(c):
            return c
    return None


@dataclass
class Settings:
    # --- upload / processing limits (security) ---
    max_upload_mb: int = _env("MAX_UPLOAD_MB", 50, int)
    max_pages: int = _env("MAX_PAGES", 200, int)
    max_concurrent_jobs: int = _env("MAX_JOBS", 2, int)
    job_timeout_s: int = _env("JOB_TIMEOUT_S", 600, int)
    result_ttl_s: int = _env("RESULT_TTL_S", 900, int)          # temp files are deleted after this long
    temp_dir: str = _env("TEMP_DIR", os.path.join(os.path.dirname(__file__), "_tmp"))
    # --- OCR ---
    tesseract_cmd: str = field(default_factory=_find_tesseract)
    ocr_lang: str = _env("OCR_LANG", "eng")
    ocr_dpi: int = _env("OCR_DPI", 300, int)
    min_native_chars: int = _env("MIN_NATIVE_CHARS", 25, int)    # fewer extractable chars than this => page treated as scanned
    ocr_min_conf: float = _env("OCR_MIN_CONF", 35.0, float)      # words below this confidence are dropped
    # --- layout ---
    column_gap_min_pt: float = _env("COL_GAP_MIN_PT", 10.0, float)
    para_gap_factor: float = _env("PARA_GAP_FACTOR", 0.55, float)  # extra line gap (x font size) that starts a new paragraph
    header_footer_band: float = _env("HF_BAND", 0.07, float)       # fraction of page height treated as header/footer candidates
    omml_equations: bool = _env("OMML", True, lambda x: str(x).lower() in ("1", "true", "yes"))   # single-line equations -> editable Word equations
    render_math_as_image: bool = _env("MATH_AS_IMAGE", True, lambda x: str(x).lower() in ("1", "true", "yes"))


settings = Settings()
