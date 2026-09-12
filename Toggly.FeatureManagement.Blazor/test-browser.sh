#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p coverage
node --experimental-test-coverage --test-coverage-include='src/**/*.js' \
  --test-coverage-lines=90 --test-coverage-functions=90 --test-coverage-branches=90 \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
  --test tests/browser.test.mjs
# The grouped scanner's base directory is the repository root, not this family.
python3 - <<'PY'
from pathlib import Path
report = Path('coverage/lcov.info')
report.write_text(report.read_text().replace('SF:src/', 'SF:Toggly.FeatureManagement.Blazor/src/'))
PY
