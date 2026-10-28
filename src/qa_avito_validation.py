from build_pilot import output_parameters
from validate_avito import parse_report


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

    outgoing = output_parameters(
        {"id": "1", "house_id": "", "source_values": {}},
        {
            "bulk_rules": [],
            "lot_values": {"1": {"NewDevelopmentId": "10189300", "Address": "Ростов-на-Дону"}},
        },
    )
    assert outgoing["NewDevelopmentId"] == "10189300"
    assert "Address" not in outgoing

    source_development = output_parameters(
        {"id": "2", "house_id": "10189300", "source_values": {}},
        {"bulk_rules": [], "lot_values": {"2": {"Address": "Ростов-на-Дону"}}},
    )
    assert "Address" not in source_development
    print("Avito validation parser QA passed")


if __name__ == "__main__":
    main()
