from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import URLError
from xml.etree import ElementTree as ET

from build_pilot import output_parameters, write_feed
from validate_avito import parse_report, request


PASSED = """
<article><fieldset><label>Общий статус</label><span class="status_success">XML соответствует формату</span></fieldset>
<fieldset><label>Файл принят</label>28.10.2026 20:21:13</fieldset>
<fieldset><label>Проверено объявлений</label>163</fieldset></article>
"""

WARNINGS = """
<article><span class="status_warnings is-yellow">XML не полностью соответствует формату</span>
<fieldset><label>Проверено объявлений</label>2</fieldset></article>
<table><tbody>
<tr><td><a name="ad_408036106"></a>408036106</td><td class="is-yellow">Не заполнено поле</td></tr>
<tr><td><a name="ad_408036107"></a>408036107</td><td class="is-green">Соответствует формату</td></tr>
</tbody></table>
"""

DUPLICATE_ERRORS = """
<article><span class="status_warnings is-yellow">XML не полностью соответствует формату</span>
<fieldset><label>Проверено объявлений</label>1</fieldset></article>
<table><tbody><tr><td><a name="ad_408036106"></a>1</td><td>408036106</td><td>
<div class="message"><span class="is-yellow">Address</span>
<div>Элементы были проигнорированы. Данные об адресе и координатах были получены по значению элемента NewDevelopmentId / Id новостройки.</div></div>
<div class="message"><span class="is-red">Id новостройки: не задано</span>
<div>Не заполнен обязательный параметр NewDevelopmentId.</div><div>Укажите его значение по правилам.</div><a>Подробнее...</a></div>
<div class="message"><span class="is-red">Ошибка параметра</span>
<div>Неправильно заполнен обязательный параметр — Адрес.</div><div>Неверный формат. Правила: Address / Адрес. Если ошибка повторяется, попробуйте другие способы исправления.</div><a>Подробнее...</a></div>
<div class="message"><span class="is-red">Ошибка параметра</span>
<div>Неправильно заполнен обязательный параметр — Адрес.</div><div>Введите значение параметра. Правила: Address / Адрес. Если ошибка повторяется, попробуйте другие способы исправления.</div><a>Подробнее...</a></div>
</td></tr></tbody></table>
"""


class FakeHeaders:
    def get_content_type(self) -> str:
        return "application/json"


class FakeResponse:
    status = 200
    headers = FakeHeaders()

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return b'{}'


def main() -> None:
    passed = parse_report(PASSED)
    assert passed["status"] == "passed"
    assert passed["checked_ads"] == 163
    assert passed["accepted_at"] == "28.10.2026 20:21:13"
    assert passed["issues"] == []

    warnings = parse_report(WARNINGS)
    assert warnings["status"] == "has_errors"
    assert warnings["checked_ads"] == 2
    assert warnings["warnings"] == 1
    assert len(warnings["issues"]) == 1
    assert warnings["issues"][0]["ad_id"] == "408036106"
    assert "Не заполнено поле" in warnings["issues"][0]["message"]

    duplicate_errors = parse_report(DUPLICATE_ERRORS)
    assert duplicate_errors["errors"] == 1
    assert duplicate_errors["warnings"] == 0
    assert duplicate_errors["issues"][0]["messages"] == [
        "Не заполнен NewDevelopmentId (ID новостройки).",
        "Address (адрес) не заполнен или имеет неверный формат.",
    ]
    assert "Подробнее" not in duplicate_errors["issues"][0]["message"]

    with (
        patch("validate_avito.urlopen", side_effect=[URLError("temporary"), FakeResponse()]) as mocked_urlopen,
        patch("validate_avito.time.sleep") as mocked_sleep,
    ):
        status, content_type, body = request("https://example.test/", accept="application/json")
    assert (status, content_type, body) == (200, "application/json", b"{}")
    assert mocked_urlopen.call_count == 2
    mocked_sleep.assert_called_once_with(1)

    outgoing = output_parameters(
        {"id": "1", "house_id": "", "source_values": {}},
        {
            "bulk_rules": [],
            "lot_values": {"1": {"NewDevelopmentId": "10189300", "Address": "Ростов-на-Дону"}},
        },
    )
    assert outgoing["NewDevelopmentId"] == "10189300"
    assert outgoing["Address"] == "Ростов-на-Дону"

    source_development = output_parameters(
        {"id": "2", "house_id": "10189300", "source_values": {}},
        {"bulk_rules": [], "lot_values": {"2": {"Address": "Ростов-на-Дону"}}},
    )
    assert source_development["Address"] == "Ростов-на-Дону"

    source_with_development = ET.fromstring(
        "<Ads><Ad><Id>2</Id><NewDevelopmentId>10189300</NewDevelopmentId>"
        "<Address>Старый адрес</Address><Images /></Ad></Ads>"
    )
    source_with_development_ad = source_with_development.find("Ad")
    assert source_with_development_ad is not None
    with TemporaryDirectory() as directory:
        destination = Path(directory) / "avito.xml"
        write_feed(
            source_with_development,
            {"2": source_with_development_ad},
            [{
                "id": "2",
                "feed_images": [],
                "feed_parameters": {
                    "NewDevelopmentId": "10189300",
                    "Address": "Ростовская область, Ростов-на-Дону, пр-т Стачки, д. 231/2",
                },
            }],
            destination,
        )
        written = ET.parse(destination).getroot().find("Ad")
        assert written is not None
        assert written.findtext("NewDevelopmentId") == "10189300"
        assert written.findtext("Address") == (
            "Ростовская область, Ростов-на-Дону, пр-т Стачки, д. 231/2"
        )

    source_root = ET.fromstring(
        "<Ads><Ad><Id>3</Id><NewDevelopmentId></NewDevelopmentId>"
        "<Address>Ростов-на-Дону</Address><Images /></Ad></Ads>"
    )
    source_ad = source_root.find("Ad")
    assert source_ad is not None
    with TemporaryDirectory() as directory:
        destination = Path(directory) / "avito.xml"
        write_feed(
            source_root,
            {"3": source_ad},
            [{"id": "3", "feed_images": [], "feed_parameters": {}}],
            destination,
        )
        written = ET.parse(destination).getroot().find("Ad")
        assert written is not None
        assert written.findtext("Address") == "Ростов-на-Дону"
    print("Avito validation parser QA passed")


if __name__ == "__main__":
    main()
