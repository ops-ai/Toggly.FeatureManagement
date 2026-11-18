#!/usr/bin/env bash
# Wait until a package@version is visible on the public npm registry.
#
# npm can report a successful publish before the registry serves that
# version. OPS-2090: @ops-ai/nextjs-toggly-core@1.16.2 was recorded at
# 21:30:06Z, 550s after the CLI reported success. A 180s or 360s budget
# still fails that lag. Default is 150 attempts * 6s = 15 minutes.
set -euo pipefail

SPEC="${1:?usage: wait-for-npm-version.sh <name@version> [max_retries] [sleep_seconds]}"
MAX_RETRIES="${2:-150}"
SLEEP_SECONDS="${3:-6}"
RETRY=0
ERR_FILE=$(mktemp)
trap 'rm -f "$ERR_FILE"' EXIT

until npm view "${SPEC}" version >"$ERR_FILE" 2>&1; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "Timed out waiting for ${SPEC} after $((MAX_RETRIES * SLEEP_SECONDS))s"
    if [ -s "$ERR_FILE" ]; then
      echo "Last npm view output:"
      cat "$ERR_FILE"
    fi
    exit 1
  fi
  echo "Waiting for ${SPEC} on npm (attempt ${RETRY}/${MAX_RETRIES})..."
  sleep "${SLEEP_SECONDS}"
done

echo "${SPEC} is on npm"
