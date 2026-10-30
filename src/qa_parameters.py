from __future__ import annotations

from apply_issue_settings import parameter_value
from parameter_catalog import PARAMETER_CATALOG


catalog = {item["tag"]: item for item in PARAMETER_CATALOG}

assert catalog["KitchenSpace"] == {
    "tag": "KitchenSpace",
    "name": "Площадь кухни",
    "kind": "number",
    "min": 2,
    "max": 100,
    "step": 0.01,
    "supported": True,
}
assert catalog["LivingSpace"]["min"] == 5
assert catalog["LivingSpace"]["max"] == 5000
assert catalog["RoomType"]["values"] == ["Изолированные", "Смежные"]
assert catalog["ContactMethod"]["default"] == "По телефону"
assert catalog["BalconyOrLoggiaMulti"]["values"] == ["Балкон", "Лоджия"]
assert catalog["VideoURL"]["kind"] == "url"
assert catalog["NDAdditionally"]["name"] == "Дополнительно о планировке"

assert parameter_value("KitchenSpace", "8,43", "KitchenSpace") == "8.43"
assert parameter_value("KitchenSpace", "100", "KitchenSpace") == "100"
assert parameter_value("LivingSpace", "42.66", "LivingSpace") == "42.66"
assert parameter_value("RoomType", ["Изолированные", "Смежные"], "RoomType") == ["Изолированные", "Смежные"]
assert parameter_value("ContactMethod", "По телефону", "ContactMethod") == "По телефону"
assert parameter_value("BalconyOrLoggiaMulti", ["Лоджия"], "BalconyOrLoggiaMulti") == ["Лоджия"]
assert parameter_value("VideoURL", "https://vkvideo.ru/video-123_456", "VideoURL") == "https://vkvideo.ru/video-123_456"
assert parameter_value("VideoURL", "https://rutube.ru/video/abcdef123456/", "VideoURL") == "https://rutube.ru/video/abcdef123456/"

for tag, value in (("KitchenSpace", "1.99"), ("LivingSpace", "5000.01")):
    try:
        parameter_value(tag, value, tag)
    except ValueError:
        pass
    else:
        raise AssertionError(f"{tag} accepted an out-of-range value")

for value in ("https://example.com/video/123", "http://vkvideo.ru/video-123_456", "https://vkvideo.ru/clip123", "https://rutube.ru/channel/123"):
    try:
        parameter_value("VideoURL", value, "VideoURL")
    except ValueError:
        pass
    else:
        raise AssertionError(f"VideoURL accepted an unsupported URL: {value}")

print({"parameter_catalog": True, "parameter_validation": True})
