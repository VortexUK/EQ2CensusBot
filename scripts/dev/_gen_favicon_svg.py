"""Embed the L&L favicon.ico as a base64 PNG inside an SVG wrapper."""

import base64
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image

ico_path = Path("frontend/public/favicon.ico")
svg_path = Path("frontend/public/favicon.svg")

img = Image.open(ico_path).convert("RGBA")
buf = io.BytesIO()
img.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()

svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'viewBox="0 0 256 256">\n'
    f'  <image width="256" height="256" '
    f'xlink:href="data:image/png;base64,{b64}"/>\n'
    "</svg>\n"
)

svg_path.write_text(svg, encoding="utf-8")
print(f"Written {svg_path} ({len(svg):,} bytes)")
