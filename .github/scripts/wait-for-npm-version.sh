#!/usr/bin/env bash
# Wait until a package@version is visible on the public npm registry.
# npm can take more than a minute to serve a version after publish.
set -euo pipefail

SPEC="${1:?usage: wait-for-npm-version.sh <name@version> [max_retries] [sleep_seconds]}"
MAX_RETRIES="${2:-30}"
SLEEP_SECONDS="${3:-6}"
RETRY=0

until npm view "${SPEC}" version >/dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "Timed out waiting for ${SPEC} after $((MAX_RETRIES * SLEEP_SECONDS))s"
    exit 1
  fi
  echo "Waiting for ${SPEC} on npm (attempt ${RETRY}/${MAX_RETRIES})..."
  sleep "${SLEEP_SECONDS}"
done

echo "${SPEC} is on npm"
