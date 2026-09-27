#!/usr/bin/env python3
"""Export each Swift product's simulator coverage to LCOV and Sonar generic XML."""

from __future__ import annotations

import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

PRODUCTS = ("TogglyCore", "TogglyCombine", "TogglySwiftUI", "TogglyUIKit")
MINIMUM_LINE_COVERAGE = 0.80


def xccov(*args: str) -> dict:
    command = ["xcrun", "xccov", "view", *args]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"xccov exited {result.returncode}: {result.stderr.strip()}")
    return json.loads(result.stdout)


def export(result_bundle: Path, lcov_path: Path, xml_path: Path) -> None:
    sdk_root = Path(__file__).resolve().parent.parent
    report = xccov("--report", "--json", str(result_bundle))
    targets = {target["name"]: target for target in report["targets"]}
    coverage = ET.Element("coverage", version="1")
    lcov: list[str] = []

    for product in PRODUCTS:
        if product not in targets:
            raise ValueError(f"Coverage archive is missing the {product} product")

        covered = executable = 0
        files = targets[product]["files"]
        if not files:
            raise ValueError(f"Coverage archive has no {product} source files")

        for source in files:
            source_path = Path(source["path"]).resolve()
            relative_path = source_path.relative_to(sdk_root)
            if relative_path.parts[:2] != (product, "Sources"):
                raise ValueError(f"Unexpected {product} coverage source: {relative_path}")

            archive = xccov("--archive", "--file", source["path"], "--json", str(result_bundle))
            lines = archive[source["path"]]
            executable_lines = [line for line in lines if line["isExecutable"]]
            if not executable_lines:
                raise ValueError(f"No executable lines for {relative_path}")

            file_element = ET.SubElement(coverage, "file", path=relative_path.as_posix())
            lcov.append(f"SF:{relative_path.as_posix()}")
            for line in executable_lines:
                hits = line.get("executionCount", 0)
                ET.SubElement(
                    file_element,
                    "lineToCover",
                    lineNumber=str(line["line"]),
                    covered="true" if hits > 0 else "false",
                )
                lcov.append(f"DA:{line['line']},{hits}")
                covered += hits > 0
                executable += 1
            lcov.extend((f"LF:{len(executable_lines)}", f"LH:{sum(line.get('executionCount', 0) > 0 for line in executable_lines)}", "end_of_record"))

        percentage = 100 * covered / executable
        print(f"{product}: {covered}/{executable} executable lines ({percentage:.2f}%)")
        if covered / executable <= MINIMUM_LINE_COVERAGE:
            raise ValueError(f"{product} line coverage must exceed 80%")

    lcov_path.parent.mkdir(parents=True, exist_ok=True)
    xml_path.parent.mkdir(parents=True, exist_ok=True)
    lcov_path.write_text("\n".join(lcov) + "\n", encoding="utf-8")
    ET.indent(coverage)
    ET.ElementTree(coverage).write(xml_path, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: xccov-to-sonar.py <result.xcresult> <out.lcov> <out.xml>")
    try:
        export(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    except (KeyError, OSError, RuntimeError, ValueError) as exc:
        sys.exit(f"coverage export failed: {exc}")
