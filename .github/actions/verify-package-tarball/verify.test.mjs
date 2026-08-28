#!/usr/bin/env node
/**
 * Smoke test for verify.mjs: known-good packed fixture vs bad file: fixture.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verify = path.join(__dirname, 'verify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-tarball-test-'));

function writePkg(dir, pkg) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), 'export const ok = true;\n');
}

const good = path.join(tmp, 'good');
writePkg(good, {
  name: 'toggly-verify-good-fixture',
  version: '1.0.0',
  type: 'module',
  main: 'index.js',
  files: ['index.js'],
});

const bad = path.join(tmp, 'bad');
writePkg(bad, {
  name: 'toggly-verify-bad-fixture',
  version: '1.0.0',
  type: 'module',
  main: 'index.js',
  files: ['index.js'],
  dependencies: {
    '@ops-ai/toggly-hooks-types': 'file:../does-not-matter',
  },
});

function runVerify(dir) {
  try {
    execFileSync(process.execPath, [verify], {
      env: { ...process.env, PACKAGE_DIR: dir, SKIP_IMPORT: 'false' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, stderr: error.stderr || '', code: error.status };
  }
}

const goodResult = runVerify(good);
if (!goodResult.ok) {
  console.error('Expected good fixture to pass', goodResult.stderr);
  process.exit(1);
}

const badResult = runVerify(bad);
if (badResult.ok) {
  console.error('Expected bad file: fixture to fail');
  process.exit(1);
}
if (!/file:|unpublishable/i.test(badResult.stderr)) {
  console.error('Expected failure to mention file:/unpublishable', badResult.stderr);
  process.exit(1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('verify-package-tarball tests passed');
