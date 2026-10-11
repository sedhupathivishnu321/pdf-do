"""Command line: python cli.py input.pdf output.docx [--ocr auto|always|never] [--pages 1-3]"""
import argparse
import json
import sys

from engine import ConversionOptions, convert_pdf


def parse_pages(s):
    if not s:
        return None
    out = []
    for part in s.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a) - 1, int(b)))
        else:
            out.append(int(part) - 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf"); ap.add_argument("docx")
    ap.add_argument("--ocr", default="auto", choices=["auto", "always", "never"])
    ap.add_argument("--lang", default="eng")
    ap.add_argument("--pages", default=None)
    ap.add_argument("--no-math-images", action="store_true")
    a = ap.parse_args()
    opts = ConversionOptions(ocr=a.ocr, ocr_lang=a.lang, pages=parse_pages(a.pages), math_as_image=not a.no_math_images)
    rep = convert_pdf(a.pdf, a.docx, opts, lambda p, m: print("\r%3d%% %s" % (p * 100, m), end="", file=sys.stderr))
    print(file=sys.stderr)
    print(json.dumps(rep.to_dict(), indent=2))


if __name__ == "__main__":
    main()
