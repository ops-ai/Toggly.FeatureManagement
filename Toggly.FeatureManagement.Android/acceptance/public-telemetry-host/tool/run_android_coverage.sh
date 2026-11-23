#!/usr/bin/env bash
# Instrumented coverage on API 36. Wait for a usable shell user before AGP's
# AndroidTestRunner runs — "Failed to get current user ID from device" is a
# boot race after sys.boot_completed flips to 1 on macos GHA emulators.

set -u

SETTLE_SECONDS="${TOGGLY_EMULATOR_SETTLE_SECONDS:-15}"
RETRY_ADB_SLEEP_SECONDS="${TOGGLY_EMULATOR_RETRY_ADB_SLEEP_SECONDS:-5}"
DEVICE_WAIT_SECONDS="${TOGGLY_EMULATOR_DEVICE_WAIT_SECONDS:-120}"

# Never call unbounded `adb wait-for-device` — if the AVD dies it blocks until
# the job timeout and prevents Kover artifact upload.
wait_for_adb_device() {
  local deadline=$1
  echo "Waiting for adb device (bounded)..."
  until adb get-state 2>/dev/null | tr -d '\r' | grep -qx device; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for adb device"
      return 1
    fi
    sleep 2
  done
}

wait_for_device_ready() {
  local deadline=$((SECONDS + DEVICE_WAIT_SECONDS))
  echo "Waiting for emulator to accept a shell user..."
  wait_for_adb_device "${deadline}" || return 1

  until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for sys.boot_completed"
      return 1
    fi
    sleep 2
  done

  until adb shell pm path android >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for package manager"
      return 1
    fi
    sleep 2
  done

  # AGP AndroidTestRunner calls am get-current-user; boot_completed alone is not enough.
  local user_id=""
  until [[ "${user_id}" =~ ^[0-9]+$ ]]; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting for am get-current-user"
      return 1
    fi
    user_id="$(adb shell am get-current-user 2>/dev/null | tr -d '\r' || true)"
    sleep 2
  done
  echo "Device ready (current user=${user_id}); settling ${SETTLE_SECONDS}s before instrumentation..."
  sleep "${SETTLE_SECONDS}"
}

write_diagnostics() {
  mkdir -p app/build/reports/androidTests/connected
  {
    echo '--- device ABI ---'
    adb shell getprop ro.product.cpu.abi || true
    echo '--- boot_completed ---'
    adb shell getprop sys.boot_completed || true
    echo '--- current user ---'
    adb shell am get-current-user || true
    echo '--- installed instrumentation ---'
    adb shell pm list instrumentation || true
    echo '--- main and crash buffers ---'
    adb logcat -d -b main -b crash -v threadtime || true
  } > app/build/reports/androidTests/connected/device-diagnostics.txt 2>&1 || true
  tail -n 200 app/build/reports/androidTests/connected/device-diagnostics.txt
}

run_coverage_once() {
  wait_for_device_ready || return $?
  ./gradlew :app:createDebugAndroidTestCoverageReport --no-daemon
}

result=0
run_coverage_once || result=$?
if [[ "${result}" -ne 0 ]]; then
  echo "Instrumented coverage attempt 1 failed; reconnecting adb and retrying once..."
  # Do not kill the AVD — android-emulator-runner owns that process.
  adb kill-server >/dev/null 2>&1 || true
  sleep "${RETRY_ADB_SLEEP_SECONDS}"
  adb start-server >/dev/null 2>&1 || true
  reconnect_deadline=$((SECONDS + DEVICE_WAIT_SECONDS))
  wait_for_adb_device "${reconnect_deadline}" || true
  result=0
  run_coverage_once || result=$?
  if [[ "${result}" -ne 0 ]]; then
    write_diagnostics
  fi
fi
exit "${result}"
