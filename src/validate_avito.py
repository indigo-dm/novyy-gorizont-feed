from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SUBMIT_URL = "https://autoload.avito.ru/api/v2/public/xml_checker/upload/"
RESULT_URL = "https://autoload.avito.ru/api/v2/public/xml_checker/result/{validation_id}/"


class ReportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.status_parts: list[str] = []
        self.status_depth = 0
        self.status_locked = False
        self.status_classes: set[str] = set()
        self.row_depth = 0
        self.row_parts: list[str] = []
        self.row_html_classes: set[str] = set()
        self.row_ad_id = ""
        self.rows: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        classes = {part for part in attributes.get("class", "").split() if part}
        if not self.status_locked and not self.status_depth and any(part.startswith("status_") for part in classes):
            self.status_depth += 1
            self.status_classes.update(classes)
        elif self.status_depth:
            self.status_depth += 1
        if tag == "tr":
            self.row_depth = 1
            self.row_parts = []
            self.row_html_classes = set(classes)
            self.row_ad_id = ""
        elif self.row_depth:
            self.row_depth += 1
            self.row_html_classes.update(classes)
            anchor = attributes.get("name", "") or attributes.get("href", "").lstrip("#")
            match = re.fullmatch(r"ad_([A-Za-z0-9_-]{1,100})", anchor)
            if match:
                self.row_ad_id = match.group(1)

    def handle_endtag(self, tag: str) -> None:
        if self.status_depth:
            self.status_depth -= 1
            if self.status_depth == 0:
                self.status_locked = True
        if not self.row_depth:
            return
        self.row_depth -= 1
        if tag == "tr" and self.row_depth == 0:
            text = clean_text(" ".join(self.row_parts))
            class_text = " ".join(sorted(self.row_html_classes)).lower()
            has_error = any(token in class_text for token in ("error", "failed", "is-red"))
            has_warning = any(token in class_text for token in ("warning", "is-yellow"))
            if self.row_ad_id and text and (has_error or has_warning):
                severity = "error" if has_error else "warning"
                self.rows.append({
                    "ad_id": self.row_ad_id,
                    "severity": severity,
                    "message": text[:4000],
                })

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text.append(data)
            if self.status_depth:
                self.status_parts.append(data)
            if self.row_depth:
                self.row_parts.append(data)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value)).strip()


def parse_report(source: str) -> dict[str, object]:
    parser = ReportParser()
    parser.feed(source)
    text = clean_text(" ".join(parser.text))
    status_text = clean_text(" ".join(parser.status_parts))
    status_classes = " ".join(sorted(parser.status_classes)).lower()
    passed = (
        "status_success" in status_classes
        or ("соответствует формату" in status_text.lower() and "не соответствует" not in status_text.lower() and "не полностью" not in status_text.lower())
    )
    checked_match = re.search(r"Проверено объявлений\s*(\d+)", text, flags=re.IGNORECASE)
    accepted_match = re.search(r"Файл принят\s*(\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}:\d{2})", text, flags=re.IGNORECASE)
    errors = sum(1 for row in parser.rows if row["severity"] == "error")
    warnings = len(parser.rows) - errors
    return {
        "status": "passed" if passed else "has_errors",
        "status_text": status_text or ("XML соответствует формату" if passed else "Авито вернул замечания"),
        "accepted_at": accepted_match.group(1) if accepted_match else "",
        "checked_ads": int(checked_match.group(1)) if checked_match else None,
        "errors": errors,
        "warnings": warnings,
        "issues": parser.rows[:1000],
    }


def request(url: str, *, data: bytes | None = None, accept: str) -> tuple[int, str, bytes]:
    headers = {
        "Accept": accept,
        "User-Agent": "indigo-feed-studio-validation/1.0",
    }
    if data is not None:
        headers["Content-Type"] = "application/xml; charset=utf-8"
    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=45) as response:
            return response.status, response.headers.get_content_type(), response.read()
    except HTTPError as error:
        return error.code, error.headers.get_content_type(), error.read()
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Official Avito validator is unavailable: {error}") from error


def official_validation(xml: bytes) -> tuple[str, dict[str, object]]:
    status, content_type, body = request(SUBMIT_URL, data=xml, accept="application/json")
    if status != 200 or content_type != "application/json":
        raise RuntimeError(f"Avito validator rejected the file: HTTP {status}")
    payload = json.loads(body.decode("utf-8"))
    validation_id = str(payload.get("data", {}).get("id") or "").strip()
    if not re.fullmatch(r"[a-f0-9]{8,64}", validation_id):
        raise RuntimeError("Avito validator returned an invalid request id")
    for _ in range(30):
        time.sleep(2.5)
        result_status, result_type, result_body = request(
            RESULT_URL.format(validation_id=validation_id),
            accept="text/html,application/json",
        )
        if result_status == 202:
            continue
        if result_status == 200 and result_type == "text/html":
            return validation_id, parse_report(result_body.decode("utf-8", errors="replace"))
        raise RuntimeError(f"Avito validator result failed: HTTP {result_status}")
    raise RuntimeError("Avito validator did not finish within 75 seconds")


def validation_meta() -> dict[str, object]:
    body = os.environ.get("ISSUE_BODY", "")
    match = re.search(
        r"FEED_VALIDATION_META_START\s*(\{.*?\})\s*FEED_VALIDATION_META_END",
        body,
        flags=re.DOTALL,
    )
    if not match:
        raise RuntimeError("Validation metadata markers are missing")
    value = json.loads(match.group(1))
    settings_hash = str(value.get("settings_hash") or "")
    if not re.fullmatch(r"[a-f0-9]{64}", settings_hash):
        raise RuntimeError("Validation settings hash is invalid")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xml", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    xml_path = Path(args.xml)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    meta = validation_meta()
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    validation_id, report = official_validation(xml_path.read_bytes())
    result = {
        "version": 1,
        "provider": "Avito XML checker",
        "provider_url": "https://autoload.avito.ru/format/xmlcheck/",
        "request": int(os.environ.get("ISSUE_NUMBER", "0") or 0),
        "project": os.environ.get("PROJECT_SLUG", "").strip(),
        "settings_hash": meta["settings_hash"],
        "requested_at": str(meta.get("requested_at") or ""),
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_checked_at": str(manifest.get("checked_at") or ""),
        "feed_ads": int(manifest.get("full_ads") or 0),
        "validation_id": validation_id,
        **report,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "project": result["project"],
        "status": result["status"],
        "checked_ads": result["checked_ads"],
        "issues": len(result["issues"]),
        "output": str(output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
