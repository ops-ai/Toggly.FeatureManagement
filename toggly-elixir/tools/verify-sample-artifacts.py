"""Verify built Hex artifacts in an ephemeral copy; never edit sample manifests.
Usage: python3 tools/verify-sample-artifacts.py /absolute/path/elixir-phoenix-sdk
"""
import io
import os
from pathlib import Path
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
    package = root / "apps" / app / f"{app}-0.1.0.tar"
    dest = work / app
    dest.mkdir()
    with tarfile.open(package) as archive:
        contents = archive.extractfile("contents.tar.gz").read()
    with tarfile.open(fileobj=io.BytesIO(contents), mode="r:gz") as archive:
        archive.extractall(dest, filter="data")
    manifest = host / "mix.exs"
    manifest.write_text(manifest.read_text().replace(f'{{:{app}, "~> 0.1.0"}}', f'{{:{app}, "~> 0.1.0", path: "{dest}", override: true}}'))
print(f"Ephemeral artifact host: {host}", flush=True)
for command in [["mix", "deps.get"], ["mix", "compile", "--warnings-as-errors"], ["mix", "assets.build"], ["mix", "test"]]:
    subprocess.run(command, cwd=host, check=True)
print(f"Artifact checks passed. Browser inspection host: {host}")
