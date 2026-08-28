#!/usr/bin/env bash
# Configure npm Trusted Publishers for every inventoried @ops-ai package (OPS-727).
# Requires: npm >= 11.5.1, org owner/admin session, interactive OTP/2FA.
# Usage: from repo root → ./ .github/package-registry/configure-npm-trusted-publishers.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INVENTORY="$ROOT/.github/package-registry/npm-packages.json"
REPO="ops-ai/Toggly.FeatureManagement"
ENV_NAME="npm-publish"

if ! command -v jq >/dev/null; then
  echo "jq is required" >&2
  exit 1
fi

echo "Configuring Trusted Publishers for packages in $INVENTORY"
echo "Repository: $REPO  Environment: $ENV_NAME"
echo

jq -r '.packages[] | "\(.name)\t\(.workflow | split("/") | last)"' "$INVENTORY" | while IFS=$'\t' read -r name workflow; do
  echo "==> $name  (workflow=$workflow)"
  npm trust github "$name" \
    --file "$workflow" \
    --repo "$REPO" \
    --env "$ENV_NAME" \
    --allow-publish \
    -y
done

echo
echo "Done. Next: strip NODE_AUTH_TOKEN / secrets.NPM_TOKEN fallbacks from each sdk-*-release.yml,"
echo "set oidcReady: true in npm-packages.json, then dispatch a patch publish and verify provenance."
