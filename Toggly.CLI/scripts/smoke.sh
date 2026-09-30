#!/usr/bin/env bash
# Advisory live smoke against a real Toggly management API.
# Requires: TOGGLY_CLIENT_ID, TOGGLY_CLIENT_SECRET
# Optional: TOGGLY_BASE_URL, TOGGLY_AUTHORITY, TOGGLY_SMOKE_APP_ID, TOGGLY_CLI
set -euo pipefail

if [[ -z "${TOGGLY_CLIENT_ID:-}" || -z "${TOGGLY_CLIENT_SECRET:-}" ]]; then
  echo "Skip: TOGGLY_CLIENT_ID / TOGGLY_CLIENT_SECRET not set." >&2
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AUTH_ARGS=(
  --client-id "$TOGGLY_CLIENT_ID"
  --client-secret "$TOGGLY_CLIENT_SECRET"
)
[[ -n "${TOGGLY_AUTHORITY:-}" ]] && AUTH_ARGS+=(--authority "$TOGGLY_AUTHORITY")
[[ -n "${TOGGLY_BASE_URL:-}" ]] && AUTH_ARGS+=(--base-url "$TOGGLY_BASE_URL")

run_cli() {
  if [[ -n "${TOGGLY_CLI:-}" ]]; then
    "$TOGGLY_CLI" "$@"
  elif command -v toggly-cli >/dev/null 2>&1; then
    toggly-cli "$@"
  else
    DOTNET_ROLL_FORWARD=LatestMajor dotnet run \
      --project "$ROOT/Toggly.CLI.csproj" \
      -c Release \
      --no-build \
      -- "$@"
  fi
}

if [[ -z "${TOGGLY_CLI:-}" ]] && ! command -v toggly-cli >/dev/null 2>&1; then
  echo "==> building CLI"
  DOTNET_ROLL_FORWARD=LatestMajor dotnet build "$ROOT/Toggly.CLI.csproj" -c Release
fi

echo "==> app list"
run_cli app list "${AUTH_ARGS[@]}"

if [[ -n "${TOGGLY_SMOKE_APP_ID:-}" ]]; then
  echo "==> feature list --app $TOGGLY_SMOKE_APP_ID"
  run_cli feature list --app "$TOGGLY_SMOKE_APP_ID" "${AUTH_ARGS[@]}"
fi

echo "Smoke OK."
