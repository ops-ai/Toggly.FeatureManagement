#!/usr/bin/env bash
# Generic post-install smoke check for any Toggly CLI distribution channel:
# assert the installed binary reports the expected version.
#
# Usage:
#   smoke-channel.sh <expected-version> [binary-name]
#
# <expected-version> is the CLI VERSION (no cli-v prefix), e.g. 0.4.0.
# [binary-name] defaults to `toggly`; pass `toggly-cli` for archive-only
# installs that keep the original binary name.
set -euo pipefail

EXPECTED_VERSION="${1:-}"
BIN="${2:-toggly}"

if [[ -z "$EXPECTED_VERSION" ]]; then
  echo "Usage: $0 <expected-version> [binary-name]" >&2
  exit 2
fi

if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "smoke-channel: '$BIN' not found on PATH" >&2
  exit 1
fi

echo "==> $BIN --version"
OUTPUT="$("$BIN" --version 2>&1)"
echo "$OUTPUT"

if [[ "$OUTPUT" != *"$EXPECTED_VERSION"* ]]; then
  echo "smoke-channel: expected version '$EXPECTED_VERSION' not found in '--version' output" >&2
  exit 1
fi

echo "smoke-channel OK: $BIN reports $EXPECTED_VERSION"
