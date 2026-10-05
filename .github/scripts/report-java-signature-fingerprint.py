#!/usr/bin/env python3
"""Report the public issuer fingerprint from one generated Maven signature."""

from pathlib import Path
import re
import subprocess
import sys


ISSUER_FINGERPRINT = re.compile(r"issuer fpr v[456] ([0-9A-Fa-f]{40,64})\b")


def fingerprint_from_directory(directory: Path) -> str:
    signatures = sorted(directory.glob("toggly-core-*.pom.asc"))
    if len(signatures) != 1 or not signatures[0].is_file():
        raise ValueError("expected one core POM signature")

    # Capture the complete packet dump so no GPG output reaches CI logs.
    packets = subprocess.run(
        ["gpg", "--batch", "--list-packets", str(signatures[0])],
        capture_output=True,
        text=True,
        check=False,
    )
    if packets.returncode != 0:
        raise ValueError("could not inspect generated signature")

    fingerprints = set(ISSUER_FINGERPRINT.findall(packets.stdout))
    if len(fingerprints) != 1:
        raise ValueError("expected one full issuer fingerprint")
    return fingerprints.pop().upper()


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: report-java-signature-fingerprint.py SIGNATURE_DIRECTORY", file=sys.stderr)
        return 2
    try:
        fingerprint = fingerprint_from_directory(Path(sys.argv[1]))
    except ValueError as error:
        print(f"Java release signature fingerprint unavailable: {error}", file=sys.stderr)
        return 1
    print(f"Java release signature issuer fingerprint: {fingerprint}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
