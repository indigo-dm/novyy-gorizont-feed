from __future__ import annotations

import html
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output"
SITE = ROOT / "site"
manifest = json.loads((OUTPUT / "pilot-manifest.json").read_text(encoding="utf-8"))

if SITE.exists():
    shutil.rmtree(SITE)
(SITE / "images").mkdir(parents=True)

for item in manifest["items"]:
    source = OUTPUT / item["output_file"]
    shutil.copy2(source, SITE / "images" / source.name)
shutil.copy2(OUTPUT / "pilot-avito.xml", SITE / "pilot-avito.xml")
(SITE / ".nojekyll").write_text("", encoding="utf-8")

cards = []
for item in manifest["items"]:
    area = str(item["area"]).replace(".", ",")
    label = f"{item['house']} · {item['rooms']}к · {area} м² · ID {item['id']}"
    cards.append(
        f'<article><img src="images/{html.escape(str(item["id"]))}.png" alt="{html.escape(label)}">'
        f'<p>{html.escape(label)}</p></article>'
    )

page = f'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Пилот брендированного фида</title>
<style>body{{margin:0;background:#f4f2ed;color:#123c3a;font:16px Arial,sans-serif}}main{{max-width:1400px;margin:auto;padding:40px}}h1{{margin:0 0 8px;font-size:38px}}.meta{{color:#65706f;margin-bottom:30px}}.notice{{padding:16px 20px;background:#cead75;color:#063b39;font-weight:700;margin:0 0 30px}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}}article{{background:#00605c;color:white}}img{{display:block;width:100%;height:auto}}p{{margin:0;padding:14px 16px;font-size:18px}}</style></head>
<body><main><h1>Пилот брендированного фида «Нового Горизонта»</h1>
<div class="meta">Источник проверен: {html.escape(manifest['checked_at'])} · квартир: {manifest['source_ads']} · уникальных планировок: {manifest['unique_plans']}</div>
<div class="notice">Демонстрационный фид. Не подключать к Avito без отдельного подтверждения.</div>
<p><a href="pilot-avito.xml">Открыть тестовый XML</a></p><section class="grid">{''.join(cards)}</section></main></body></html>'''
(SITE / "index.html").write_text(page, encoding="utf-8")
(SITE / "status.json").write_text(json.dumps({
    "project": manifest["project"],
    "checked_at": manifest["checked_at"],
    "source_ads": manifest["source_ads"],
    "unique_plans": manifest["unique_plans"],
    "publish_ready": False,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(SITE)
