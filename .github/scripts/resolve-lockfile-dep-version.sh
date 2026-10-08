#!/usr/bin/env bash
# Print the locked version of a dependency from an npm package-lock.json.
# Refuses file:/link: resolved entries so release jobs cannot wait on a local path.
set -euo pipefail

LOCKFILE="${1:?usage: resolve-lockfile-dep-version.sh <package-lock.json> <package-name>}"
PKG="${2:?usage: resolve-lockfile-dep-version.sh <package-lock.json> <package-name>}"

node -e '
  const fs = require("fs");
  const lockPath = process.argv[1];
  const pkg = process.argv[2];
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const key = "node_modules/" + pkg;
  const entry = lock.packages?.[key];
  if (!entry?.version) {
    console.error("Missing lock entry for " + key + " in " + lockPath);
    process.exit(1);
  }
  const resolved = String(entry.resolved || "");
  if (/^(file|link):/i.test(resolved)) {
    console.error("Refusing local-path lock entry for " + pkg + ": " + resolved);
    process.exit(1);
  }
  process.stdout.write(String(entry.version));
' "$LOCKFILE" "$PKG"
echo
