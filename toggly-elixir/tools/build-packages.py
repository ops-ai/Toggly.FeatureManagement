"""Build the three packages with registry-only metadata; no publication."""
from pathlib import Path
import os
import subprocess
root = Path(__file__).resolve().parents[1]
for app in ["toggly", "toggly_phoenix", "toggly_live_view"]:
    subprocess.run(["mix", "hex.build"], cwd=root / "apps" / app,
                   env={**os.environ, "TOGGLY_HEX_BUILD": "1"}, check=True)
