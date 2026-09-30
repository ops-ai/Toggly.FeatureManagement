#!/usr/bin/env bash
# Render Toggly CLI package-manager templates against a published cli-v*
# GitHub Release: fetches SHA256SUMS, substitutes {{VERSION}} / {{SHA256_*}} /
# {{ARCH}} placeholders, and writes rendered files under OUTPUT_DIR.
#
# GitHub Release assets remain the single source of truth (see
# Toggly.CLI/packaging/README.md); this script never rebuilds a binary.
#
# Usage:
#   render-templates.sh <tag> [output_dir]
#
# Example:
#   ./render-templates.sh cli-v0.4.0
#   ./render-templates.sh cli-v0.4.0 /tmp/dist
set -euo pipefail

REPO="ops-ai/Toggly.FeatureManagement"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # .../packaging
TAG="${1:-}"

if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag e.g. cli-v0.4.0> [output_dir]" >&2
  exit 2
fi

VERSION="${TAG#cli-v}"
OUT_DIR="${2:-$SCRIPT_DIR/dist/$VERSION}"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"

mkdir -p "$OUT_DIR"

echo "==> Fetching SHA256SUMS for $TAG"
SUMS_FILE="$(mktemp)"
trap 'rm -f "$SUMS_FILE"' EXIT
curl -fsSL "$BASE_URL/SHA256SUMS" -o "$SUMS_FILE"

sha_for() {
  local asset="$1"
  local sha
  sha="$(awk -v a="$asset" '$2 == a { print $1 }' "$SUMS_FILE")"
  if [[ -z "$sha" ]]; then
    echo "Missing SHA256 for asset '$asset' in $BASE_URL/SHA256SUMS" >&2
    exit 1
  fi
  echo "$sha"
}

SHA256_LINUX_X64="$(sha_for toggly-cli-linux-x64.tar.gz)"
SHA256_LINUX_ARM64="$(sha_for toggly-cli-linux-arm64.tar.gz)"
SHA256_MACOS_X64="$(sha_for toggly-cli-macos-x64.tar.gz)"
SHA256_MACOS_ARM64="$(sha_for toggly-cli-macos-arm64.tar.gz)"
SHA256_WINDOWS_X64="$(sha_for toggly-cli-windows-x64.zip)"

render() {
  local src="$1" dst="$2" arch="${3:-}"
  mkdir -p "$(dirname "$dst")"
  local sed_args=(
    -e "s/{{VERSION}}/$VERSION/g"
    -e "s/{{SHA256_LINUX_X64}}/$SHA256_LINUX_X64/g"
    -e "s/{{SHA256_LINUX_ARM64}}/$SHA256_LINUX_ARM64/g"
    -e "s/{{SHA256_MACOS_X64}}/$SHA256_MACOS_X64/g"
    -e "s/{{SHA256_MACOS_ARM64}}/$SHA256_MACOS_ARM64/g"
    -e "s/{{SHA256_WINDOWS_X64}}/$SHA256_WINDOWS_X64/g"
  )
  if [[ -n "$arch" ]]; then
    sed_args+=(-e "s/{{ARCH}}/$arch/g")
  fi
  sed "${sed_args[@]}" "$src" > "$dst"
  echo "  rendered $dst"
}

echo "==> Rendering templates for $TAG (version $VERSION) into $OUT_DIR"

# Homebrew + Scoop both publish into the single ops-ai/toggly-cli-dist repo
# (main branch). Rendered paths below already mirror that repo's layout so
# the distribute workflow can copy them in directly:
#   Formula/toggly-cli.rb   <- homebrew/Formula/toggly-cli.rb
#   toggly-cli.json         <- scoop/toggly-cli.json
render "$SCRIPT_DIR/homebrew/toggly-cli.rb.tmpl" \
  "$OUT_DIR/homebrew/Formula/toggly-cli.rb"

render "$SCRIPT_DIR/scoop/toggly-cli.json.tmpl" \
  "$OUT_DIR/scoop/toggly-cli.json"

WINGET_DIR="$OUT_DIR/winget/manifests/o/Opsai/TogglyCLI/$VERSION"
render "$SCRIPT_DIR/winget/Opsai.TogglyCLI.yaml.tmpl" \
  "$WINGET_DIR/Opsai.TogglyCLI.yaml"
render "$SCRIPT_DIR/winget/Opsai.TogglyCLI.installer.yaml.tmpl" \
  "$WINGET_DIR/Opsai.TogglyCLI.installer.yaml"
render "$SCRIPT_DIR/winget/Opsai.TogglyCLI.locale.en-US.yaml.tmpl" \
  "$WINGET_DIR/Opsai.TogglyCLI.locale.en-US.yaml"

render "$SCRIPT_DIR/chocolatey/toggly-cli.nuspec.tmpl" \
  "$OUT_DIR/chocolatey/toggly-cli.nuspec"
render "$SCRIPT_DIR/chocolatey/tools/chocolateyinstall.ps1.tmpl" \
  "$OUT_DIR/chocolatey/tools/chocolateyinstall.ps1"
render "$SCRIPT_DIR/chocolatey/tools/chocolateyuninstall.ps1.tmpl" \
  "$OUT_DIR/chocolatey/tools/chocolateyuninstall.ps1"

for arch in amd64 arm64; do
  render "$SCRIPT_DIR/nfpm/toggly-cli.yaml.tmpl" \
    "$OUT_DIR/nfpm/toggly-cli-$arch.yaml" "$arch"
done

echo "==> Done. Rendered channel files under $OUT_DIR"
