import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const script = new URL('./npm-publish-if-absent.sh', import.meta.url);

function runPublish(fakeNpmBody, args = ['@ops-ai/example', '0.6.1', '--', 'npm', 'publish', '--provenance', '--access', 'public']) {
  const root = mkdtempSync(path.join(tmpdir(), 'npm-publish-if-absent-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'npm-calls.log');
  mkdirSync(bin);
  const npm = path.join(bin, 'npm');
  writeFileSync(npm, `#!/usr/bin/env bash\necho "$@" >> ${JSON.stringify(log)}\n${fakeNpmBody}\n`);
  chmodSync(npm, 0o755);
  const result = spawnSync('bash', [script.pathname, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  rmSync(root, { recursive: true, force: true });
  return { ...result, calls };
}

test('skips publish when the exact version is already on npm', () => {
  const result = runPublish('if [[ "$1" == "view" ]]; then exit 0; fi\nexit 1\n');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ['view @ops-ai/example@0.6.1 version']);
  assert.match(result.stdout, /already on the registry/);
});

test('publishes when the exact version is not on npm', () => {
  const result = runPublish(`
if [[ "$1" == "view" ]]; then exit 1; fi
if [[ "$1" == "publish" ]]; then exit 0; fi
exit 1
`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    'view @ops-ai/example@0.6.1 version',
    'publish --provenance --access public',
  ]);
});

test('treats republish of the same version as success', () => {
  const result = runPublish(`
if [[ "$1" == "view" ]]; then exit 1; fi
if [[ "$1" == "publish" ]]; then
  echo "npm error You cannot publish over the previously published versions: 0.6.1." >&2
  exit 1
fi
exit 1
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /treating as success/);
  assert.equal(result.calls.length, 2);
});

test('still fails when publish fails for another reason', () => {
  const result = runPublish(`
if [[ "$1" == "view" ]]; then exit 1; fi
echo "npm error 403 Forbidden" >&2
exit 1
`);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /403 Forbidden/);
  assert.doesNotMatch(result.stdout, /treating as success/);
});

test('rejects a missing publish command', () => {
  const result = runPublish('', ['@ops-ai/example', '0.6.1']);
  assert.equal(result.status, 2);
});
