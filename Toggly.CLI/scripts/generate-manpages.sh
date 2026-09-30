#!/usr/bin/env bash
# Thin wrapper so CI/docs can call generate-manpages.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$ROOT/generate-manpages.py" "$@"
