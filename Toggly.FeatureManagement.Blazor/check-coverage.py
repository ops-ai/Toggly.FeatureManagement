"""Fail unless each new package exceeds 90% line and branch coverage."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
reports = list(Path(sys.argv[1]).rglob("coverage.cobertura.xml"))
if not reports:
    raise SystemExit("No coverage report found")
report = max(reports, key=lambda path: path.stat().st_mtime)
packages = ET.parse(report).findall("./packages/package")
expected = {"Toggly.FeatureManagement.Blazor", "Toggly.FeatureManagement.Blazor.Server"}
found = set()
for package in packages:
    if package.attrib["name"] in expected:
        found.add(package.attrib["name"])
        for metric in ("line-rate", "branch-rate"):
            rate = float(package.attrib[metric])
            print(f"{package.attrib['name']} {metric}: {rate:.2%}")
            if rate <= 0.90:
                raise SystemExit(f"{metric} must exceed 90%")
if found != expected:
    raise SystemExit("Missing Blazor package coverage")
