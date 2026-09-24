from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "output" / "pilot-manifest.json").read_text(encoding="utf-8"))
items = manifest["items"]

font_path = ROOT / "assets" / "Manrope-Variable.ttf"
title_font = ImageFont.truetype(str(font_path), 42)
subtitle_font = ImageFont.truetype(str(font_path), 22)
label_font = ImageFont.truetype(str(font_path), 21)

cols = 3
thumb_w, thumb_h = 420, 315
card_w, card_h = 420, 365
gap = 30
margin = 50
header_h = 145
rows = (len(items) + cols - 1) // cols
canvas_w = margin * 2 + cols * card_w + (cols - 1) * gap
canvas_h = header_h + margin + rows * card_h + (rows - 1) * gap + margin
canvas = Image.new("RGB", (canvas_w, canvas_h), "#F4F2ED")
draw = ImageDraw.Draw(canvas)
draw.text((margin, 35), "Пилот брендированного фида", font=title_font, fill="#00605C")
draw.text((margin, 92), f"{len(items)} уникальных планировок · актуальный фид {manifest['checked_at']}", font=subtitle_font, fill="#596563")

for index, item in enumerate(items):
    row, col = divmod(index, cols)
    x = margin + col * (card_w + gap)
    y = header_h + margin + row * (card_h + gap)
    image = Image.open(ROOT / "output" / item["output_file"]).convert("RGB")
    thumb = ImageOps.fit(image, (thumb_w, thumb_h), method=Image.Resampling.LANCZOS)
    canvas.paste(thumb, (x, y))
    draw.rectangle((x, y + thumb_h, x + card_w, y + card_h), fill="#00605C")
    area = str(item["area"]).replace(".", ",")
    label = f"{item['house']} · {item['rooms']}к · {area} м² · ID {item['id']}"
    draw.text((x + 15, y + thumb_h + 13), label, font=label_font, fill="white")

out = ROOT / "output" / "pilot-gallery.jpg"
canvas.save(out, quality=91, optimize=True)
print(out)
