#!/usr/bin/env bash
# Build the SDK's release JARs into an isolated repository, then run consumer hosts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MAVEN_REPO_LOCAL_WAS_SET="${MAVEN_REPO_LOCAL:+true}"
MAVEN_REPO_LOCAL="${MAVEN_REPO_LOCAL:-$(mktemp -d)}"
TOGGLY_VERSION="${TOGGLY_VERSION:-$(mvn -q -DforceStdout help:evaluate -Dexpression=project.version -f "${SDK_ROOT}/pom.xml")}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
export REDIS_HOST REDIS_PORT

cleanup_repo=false
if [[ -z "${MAVEN_REPO_LOCAL_WAS_SET}" ]]; then
  cleanup_repo=true
fi

cleanup() {
  if [[ "${cleanup_repo}" == true ]]; then
    rm -rf "${MAVEN_REPO_LOCAL}"
  fi
}
trap cleanup EXIT

"${SCRIPT_DIR}/verify-host-fixture-contract.sh"

mvn -B -Dmaven.repo.local="${MAVEN_REPO_LOCAL}" -DskipTests install -f "${SDK_ROOT}/pom.xml"

for fixture in caffeine servlet redis-jedis5 redis-jedis8; do
  fixture_root="${SCRIPT_DIR}/${fixture}"
  mvn -B -Dmaven.repo.local="${MAVEN_REPO_LOCAL}" \
    -Dtoggly.version="${TOGGLY_VERSION}" \
    -Dredis.host="${REDIS_HOST}" \
    -Dredis.port="${REDIS_PORT}" \
    -f "${fixture_root}/pom.xml" test
done

for fixture in redis-jedis5 redis-jedis8; do
  expected_version="5.1.5"
  if [[ "${fixture}" == "redis-jedis8" ]]; then
    expected_version="8.0.1"
  fi
  tree_file="$(mktemp)"
  mvn -q -Dmaven.repo.local="${MAVEN_REPO_LOCAL}" \
    -Dtoggly.version="${TOGGLY_VERSION}" \
    -f "${SCRIPT_DIR}/${fixture}/pom.xml" \
    dependency:tree -Dincludes=redis.clients:jedis -DoutputFile="${tree_file}"
  grep -F "redis.clients:jedis:jar:${expected_version}:compile" "${tree_file}"
  rm -f "${tree_file}"
done
