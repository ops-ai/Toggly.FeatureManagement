#!/usr/bin/env bash

result=0
./gradlew :app:createDebugAndroidTestCoverageReport --no-daemon || result=$?
if [[ "$result" -ne 0 ]]; then
  mkdir -p app/build/reports/androidTests/connected
  {
    echo '--- device ABI ---'
    adb shell getprop ro.product.cpu.abi
    echo '--- installed instrumentation ---'
    adb shell pm list instrumentation
    echo '--- main and crash buffers ---'
    adb logcat -d -b main -b crash -v threadtime
  } > app/build/reports/androidTests/connected/device-diagnostics.txt 2>&1 || true
  tail -n 200 app/build/reports/androidTests/connected/device-diagnostics.txt
fi
exit "$result"
