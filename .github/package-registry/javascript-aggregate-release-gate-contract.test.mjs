import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const releaseWorkflows = fs
  .readdirSync(path.join(repository, '.github/workflows'))
  .filter((name) => name.startsWith('sdk-') && name.endsWith('-release.yml'))
  .map((name) => path.join(repository, '.github/workflows', name))
  .filter((filePath) => fs.readFileSync(filePath, 'utf8').includes('javascript-aggregate-release-gate.yml'));

test('every JS release workflow grants actions:write on the aggregate gate job', () => {
  assert.ok(releaseWorkflows.length >= 17, 'expected at least 17 JS release gate callers');
  for (const filePath of releaseWorkflows) {
    const source = fs.readFileSync(filePath, 'utf8');
    const gateBlock = source.match(
      /\n  gates:\n[\s\S]*?uses: \.\/\.github\/workflows\/javascript-aggregate-release-gate\.yml/,
    )?.[0];
    assert.ok(gateBlock, `${path.basename(filePath)} must define a gates job calling the aggregate gate`);
    assert.match(gateBlock, /permissions:\s*\n\s+actions: write/);
    assert.match(gateBlock, /contents: read/);
    assert.match(gateBlock, /checks: read/);
    assert.match(gateBlock, /statuses: read/);
    assert.doesNotMatch(gateBlock, /uses: \.\/\.github\/workflows\/analysis-javascript\.yml/);
  }
});

test('aggregate release gate workflow passes github.token to the wait script', () => {
  const gate = fs.readFileSync(
    path.join(repository, '.github/workflows/javascript-aggregate-release-gate.yml'),
    'utf8',
  );
  assert.doesNotMatch(gate, /concurrency:/);
  assert.match(gate, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(gate, /uses: actions\/checkout@v7/);
  assert.match(gate, /statuses: read/);
});

test('verify workflow passes PR head SHA into the aggregate gate', () => {
  const verify = fs.readFileSync(
    path.join(repository, '.github/workflows/verify-javascript-aggregate-release-gate.yml'),
    'utf8',
  );
  assert.match(verify, /commit_sha: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
});
