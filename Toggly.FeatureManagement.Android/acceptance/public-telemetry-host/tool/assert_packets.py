"""Validate the full signed app's loopback telemetry capture, separately from its API marker."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("capture", type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.capture.read_text().splitlines()]
    assert len(rows) >= 2, f"expected at least two packets, got {len(rows)}"
    for row in rows:
        assert row["path"] == "/api/frontend/telemetry"
        assert row["encoding"] in ("gzip", "plain")
        assert all(row[field] is None for field in ("origin", "cookie", "authorization"))
        assert row["packet"]["k"] == "local-public-android"
        assert row["packet"]["e"] == "Acceptance"
    first = rows[0]["packet"]
    assert first.get("u") == "native-a" and "i" not in first
    assert first["f"]["checkout"]["preview-a"][1:] == [1, 1]
    assert first["m"]["orders"] == 2 and first["m"]["queue"] == 3.5
    minted = [row["packet"] for row in rows[1:] if row["packet"].get("i") == "local-minted-fixture"]
    assert minted and all("u" not in packet for packet in minted)
    assert any(packet.get("f", {}).get("after-replacement", {}).get("enabled", [0, 0])[1] == 1
               for packet in minted), "post-replacement explicit usage was not delivered"
    assert all("preview-a" not in packet.get("f", {}).get("checkout", {}) for packet in minted)
    assert any(row["encoding"] == "plain" and
               row["packet"].get("f", {}).get("teardown", {}).get("enabled", [0, 0])[1] == 1
               for row in rows), "plain final-disposal usage was not delivered"
    print(f"PASS: {len(rows)} credential-free loopback packets, attribution and plain disposal")


if __name__ == "__main__":
    main()
