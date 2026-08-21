#!/usr/bin/env python3
"""Convert LCOV to Sonar generic coverage XML."""

from __future__ import annotations

import sys
from xml.sax.saxutils import escape


def convert(lcov_path: str, out_path: str) -> None:
    files: list[tuple[str, list[tuple[int, int]]]] = []
    current: str | None = None
    lines: list[tuple[int, int]] = []

    with open(lcov_path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if line.startswith("SF:"):
                if current is not None:
                    files.append((current, lines))
                current = line[3:]
                lines = []
            elif line.startswith("DA:") and current is not None:
                number, hits = line[3:].split(",")[:2]
                lines.append((int(number), int(hits)))
            elif line == "end_of_record" and current is not None:
                files.append((current, lines))
                current = None
                lines = []

    if current is not None:
        files.append((current, lines))

    with open(out_path, "w", encoding="utf-8") as output:
        output.write('<coverage version="1">\n')
        for path, covered_lines in files:
            output.write(f'  <file path="{escape(path)}">\n')
            for number, hits in covered_lines:
                covered = "true" if hits > 0 else "false"
                output.write(
                    f'    <lineToCover lineNumber="{number}" covered="{covered}"/>\n'
                )
            output.write("  </file>\n")
        output.write("</coverage>\n")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.stderr.write("usage: lcov-to-sonar.py <lcov> <out-xml>\n")
        sys.exit(2)
    convert(sys.argv[1], sys.argv[2])
