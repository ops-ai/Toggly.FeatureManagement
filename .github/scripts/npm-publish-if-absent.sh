#!/usr/bin/env bash
# Publish only when package@version is not already on npm.
#
# resolve-release-version reads the dist-tag `latest`, then release workflows
# wait on the JavaScript aggregate gate. A version published by the previous
# develop run can be invisible to that lookup and visible by the time
# `npm publish` runs. Republishing that same version must not fail the workflow.
#
# Usage: npm-publish-if-absent.sh <package> <version> -- <publish command...>
set -euo pipefail

if [[ $# -lt 4 || "$3" != "--" ]]; then
  echo "usage: npm-publish-if-absent.sh <package> <version> -- <publish command...>" >&2
  exit 2
fi

package="$1"
version="$2"
shift 3

if npm view "${package}@${version}" version >/dev/null 2>&1; then
  echo "::notice::Skipping publish; ${package}@${version} is already on the registry."
  exit 0
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

set +e
"$@" >"$log" 2>&1
status=$?
set -e
cat "$log"

if [[ "$status" -eq 0 ]]; then
  exit 0
fi

conflict="You cannot publish over the previously published versions: ${version}"
if grep -F "$conflict" "$log" >/dev/null; then
  echo "::notice::Publish rejected because ${package}@${version} is already on the registry; treating as success."
  exit 0
fi

exit "$status"
