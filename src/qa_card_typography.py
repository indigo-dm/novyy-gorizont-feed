from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
renderer = (ROOT / "src" / "render_pilot.cjs").read_text(encoding="utf-8")

assert ".promo{position:absolute;top:117px" in renderer
assert "font-size:34px" in renderer.split(".promo{", 1)[1].split("}", 1)[0]
assert "font-size:34px" in renderer.split(".promo span{", 1)[1].split("}", 1)[0]
assert "font-size:28px" in renderer.split(".lot{", 1)[1].split("}", 1)[0]
assert "async function fitPromotionBadge(page)" in renderer
assert "while (badge.scrollWidth > badge.clientWidth + 1 && valueSize > 18)" in renderer
assert "await fitPromotionBadge(page);" in renderer

print({
    "promotion_font_is_visibly_larger_than_lot_title": True,
    "long_promotion_auto_fit": True,
})
