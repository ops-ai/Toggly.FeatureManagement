#!/usr/bin/env bash
# Sync Java SDK module versions after resolve-release-version updates the parent POM.
# Usage: VERSION=1.5.1 ./sync-java-sdk-version.sh [SDK_ROOT]
set -euo pipefail

ROOT="${1:-Toggly.FeatureManagement.Java}"
VERSION="${VERSION:?VERSION is required}"

if [[ ! -f "${ROOT}/pom.xml" ]]; then
  echo "Missing ${ROOT}/pom.xml" >&2
  exit 1
fi

perl -0pi -e 's{(<artifactId>toggly-parent</artifactId>\s*<version>)[^<]+(</version>)}{${1}$ENV{VERSION}${2}}' \
  "${ROOT}/pom.xml"

for pom in "${ROOT}"/toggly-*/pom.xml; do
  perl -0pi -e 's{(<parent>\s*<groupId>io\.toggly</groupId>\s*<artifactId>toggly-parent</artifactId>\s*<version>)[^<]+(</version>)}{${1}$ENV{VERSION}${2}}' "$pom"
done

perl -pi -e 's/(SDK_VERSION = ")[^"]+(")/${1}$ENV{VERSION}${2}/' \
  "${ROOT}/toggly-core/src/main/java/io/toggly/core/SdkIdentity.java"

echo "Synced Java SDK versions to ${VERSION} under ${ROOT}"
