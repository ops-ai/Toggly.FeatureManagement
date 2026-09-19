#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p coverage
node --experimental-test-coverage --test-coverage-include='src/**/*.js' \
  --test-coverage-lines=90 --test-coverage-functions=90 --test-coverage-branches=90 \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
  --test tests/browser.test.mjs
# The .NET scanner resolves JS coverage within modules, so use real source paths.
python3 - <<'PY'
from pathlib import Path
report = Path('coverage/lcov.info')
lines = report.read_text().splitlines()
for index, line in enumerate(lines):
    if line.startswith('SF:'):
        source = Path(line[3:]).resolve(strict=True)
        if not source.is_file():
            raise ValueError(f'LCOV source is not a file: {source}')
        lines[index] = f'SF:{source}'
report.write_text('\n'.join(lines) + '\n')
PY
