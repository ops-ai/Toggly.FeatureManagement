#!/usr/bin/env bash
# Consumer fixtures must resolve installed artifacts, never reactor paths or local source trees.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if rg -n '<relativePath>|<systemPath>|file:|\.\./' "${SCRIPT_DIR}" --glob 'pom.xml'; then
  echo "Host fixture POMs must not use reactor, system, file, or relative-path dependencies." >&2
  exit 1
fi
