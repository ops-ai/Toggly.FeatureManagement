import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const temporaryCoverage = path.resolve('.tooling-coverage');
try {
  execFileSync(process.execPath, [require.resolve('c8/bin/c8.js'),
    '--reporter=lcovonly', `--reports-dir=${temporaryCoverage}`,
    '--include=scripts/build-compatible-package.mjs',
    process.execPath, '--test', 'scripts/build-compatible-package.spec.ts'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', 'scripts/verify-host-cleanup.spec.ts'], { stdio: 'inherit' });
  const tooling = fs.readFileSync(path.join(temporaryCoverage, 'lcov.info'), 'utf8');
  assert.match(tooling, /SF:scripts\/build-compatible-package\.mjs/);
  assert.match(tooling, /LH:[1-9]\d*/);
  const angularCoverage = 'coverage/ngx-feature-flags-toggly/lcov.info';
  if (fs.existsSync(angularCoverage)) {
    // The existing hosted collector expects one lcov.info per SDK. Preserve the
    // Angular report and append measured tooling records, never synthetic hits.
    const angular = fs.readFileSync(angularCoverage, 'utf8');
    const records = angular.split('end_of_record\n').filter(record =>
      record.trim() && !record.includes('SF:scripts/build-compatible-package.mjs'));
    fs.writeFileSync(angularCoverage, `${records.join('end_of_record\n')}end_of_record\n${tooling}`);
  }
} finally {
  fs.rmSync(temporaryCoverage, { recursive: true, force: true });
}
