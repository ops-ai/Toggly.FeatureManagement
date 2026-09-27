"""Verify built Hex artifacts in an ephemeral copy; never edit sample manifests.
Usage: python3 tools/verify-sample-artifacts.py /absolute/path/elixir-phoenix-sdk
"""
import io
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

root = Path(__file__).resolve().parents[1]
work = Path(tempfile.mkdtemp(prefix="toggly-hex-"))
host = work / "showcase"
shutil.copytree(Path(sys.argv[1]), host, ignore=shutil.ignore_patterns("deps", "_build", ".env", "mix.lock"))
for app in ["toggly", "toggly_phoenix", "toggly_live_view"]:
    version = subprocess.check_output(
        ["mix", "run", "--no-start", "-e", "IO.write(Mix.Project.config()[:version])"],
        cwd=root / "apps" / app,
        text=True,
    ).strip()
    package = root / "apps" / app / f"{app}-{version}.tar"
    if not package.is_file():
        raise FileNotFoundError(f"Build {app} {version} before verifying sample artifacts")
    dest = work / app
    dest.mkdir()
    with tarfile.open(package) as archive:
        contents = archive.extractfile("contents.tar.gz").read()
    with tarfile.open(fileobj=io.BytesIO(contents), mode="r:gz") as archive:
        archive.extractall(dest, filter="data")
    manifest = host / "mix.exs"
    source = manifest.read_text()
    updated, replacements = re.subn(
        rf'\{{:{app},\s*"[^"]+"\}}',
        f'{{:{app}, "~> {version}", path: "{dest}", override: true}}',
        source,
    )
    if replacements != 1:
        raise ValueError(f"Expected exactly one {app} dependency in {manifest}")
    manifest.write_text(updated)
print(f"Ephemeral artifact host: {host}", flush=True)
for command in [["mix", "deps.get"], ["mix", "compile", "--warnings-as-errors"], ["mix", "assets.build"], ["mix", "test"]]:
    subprocess.run(command, cwd=host, check=True)
print(f"Artifact checks passed. Browser inspection host: {host}")
