"""Generates the MSIX tile/icon PNGs in msix/Assets from a 1024px transparent logo (python make_assets.py logo1024.png)."""
import os, sys
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGBA')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Assets')
os.makedirs(out, exist_ok=True)
BG = (23, 18, 47, 255)  # tile background #17122F, same as BackgroundColor in the manifest

def logo(size):
    return src.resize((size, size), Image.LANCZOS)

def square(name, base, scales, fill=0.86):
    for sc in scales:
        px = round(base * sc / 100)
        im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
        lg = logo(round(px * fill)); im.alpha_composite(lg, ((px - lg.width) // 2, (px - lg.height) // 2))
        im.save(os.path.join(out, f'{name}.scale-{sc}.png'))

def wide(name, bw, bh, scales):
    for sc in scales:
        w, h = round(bw * sc / 100), round(bh * sc / 100)
        im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        lg = logo(round(h * 0.80)); im.alpha_composite(lg, ((w - lg.width) // 2, (h - lg.height) // 2))
        im.save(os.path.join(out, f'{name}.scale-{sc}.png'))

SC = (100, 125, 150, 200, 400)
square('Square44x44Logo', 44, SC, 1.0)
square('Square150x150Logo', 150, SC, 0.72)
square('Square310x310Logo', 310, SC, 0.72)
square('StoreLogo', 50, SC, 1.0)
wide('Wide310x150Logo', 310, 150, SC)
for t in (16, 24, 32, 48, 256):
    im = logo(t)
    im.save(os.path.join(out, f'Square44x44Logo.targetsize-{t}.png'))
    im.save(os.path.join(out, f'Square44x44Logo.targetsize-{t}_altform-unplated.png'))
    im.save(os.path.join(out, f'Square44x44Logo.altform-lightunplated_targetsize-{t}.png'))
print(len(os.listdir(out)), 'asset files')
