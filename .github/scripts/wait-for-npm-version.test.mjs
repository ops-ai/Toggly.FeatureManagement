import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./wait-for-npm-version.sh', import.meta.url));

function withFakeNpm(body, run) {
  const dir = mkdtempSync(join(tmpdir(), 'wait-npm-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const npm = join(bin, 'npm');
  writeFileSync(npm, `#!/bin/sh\n${body}\n`);
  chmodSync(npm, 0o755);
  try {
    return run(bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runWait(bin, args) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

test('default budget is 15 minutes', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /MAX_RETRIES="\$\{2:-150\}"/);
  assert.match(source, /SLEEP_SECONDS="\$\{3:-6\}"/);
});

test('returns as soon as npm view succeeds', () => {
  const result = withFakeNpm('exit 0', (bin) => runWait(bin, ['@ops-ai/example@1.0.0', '3', '0']));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /@ops-ai\/example@1\.0\.0 is on npm/);
  assert.doesNotMatch(result.stdout, /Waiting for/);
});

test('retries until the version is visible', () => {
  const result = withFakeNpm(`
count_file="$WAIT_NPM_COUNT"
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$count_file"
if [ "$n" -ge 3 ]; then
  exit 0
fi
echo "npm error code E404" >&2
exit 1
`, (bin) => {
    const count = join(bin, '..', 'count');
    return spawnSync('bash', [script, '@ops-ai/example@1.2.3', '5', '0'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WAIT_NPM_COUNT: count },
    });
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /attempt 1\/5/);
  assert.match(result.stdout, /attempt 2\/5/);
  assert.doesNotMatch(result.stdout, /attempt 3\/5/);
  assert.match(result.stdout, /is on npm/);
});

test('default retry count is 150 and the last npm error is printed', () => {
  const result = withFakeNpm(`
echo "npm error code E404"
echo "npm error 404 Not Found - GET https://registry.npmjs.org/example" >&2
exit 1
`, (bin) => runWait(bin, ['example@9.9.9', '', '0']));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /attempt 149\/150/);
  assert.doesNotMatch(result.stdout, /attempt 150\/150/);
  assert.match(result.stdout, /Timed out waiting for example@9\.9\.9 after 0s/);
  assert.match(result.stdout, /Last npm view output:/);
  assert.match(result.stdout, /npm error code E404/);
  assert.match(result.stdout, /404 Not Found/);
});
