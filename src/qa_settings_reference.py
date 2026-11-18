from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

from resolve_settings_reference import reference_from_body, verify_file


payload = {"version": 4, "project": "orion", "rules": [], "parameter_settings": {"bulk_rules": []}}
source = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
digest = hashlib.sha256(source).hexdigest()
key = "settings-requests/apply/orion/12345678-1234-1234-1234-123456789abc.json"
body = (
    "Feed Studio request\n\nFEED_SETTINGS_REF_START\n"
    + json.dumps({"version": 1, "key": key, "sha256": digest})
    + "\nFEED_SETTINGS_REF_END"
)

reference = reference_from_body(body)
assert reference == {"key": key, "sha256": digest}
assert reference_from_body("legacy payload") is None

with tempfile.TemporaryDirectory() as temporary:
    path = Path(temporary) / "settings.json"
    path.write_bytes(source)
    verify_file(path, digest)
    try:
        verify_file(path, "0" * 64)
    except ValueError as error:
        assert "digest" in str(error)
    else:
        raise AssertionError("Digest mismatch was not rejected")

print({"r2_settings_reference": True, "sha256_verified": True, "legacy_issue_supported": True})
