import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNpmCli, resolveNpmCli } from './npm-cli.mjs';
test('npm launcher refuses relative, mislabeled and unbound executables', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'solid-npm-test-')));
  try {
    assert.throws(() => validateNpmCli('npm'), /absolute/);
    mkdirSync(join(root, 'bin'));
    const cli = join(root, 'bin', 'npm-cli.js');
    writeFileSync(cli, '');
    const metadata = join(root, 'package.json');
    writeFileSync(metadata, JSON.stringify({ name: 'other', bin: { npm: 'bin/npm-cli.js' } }));
    assert.throws(() => validateNpmCli(cli), /does not match/);
    writeFileSync(metadata, JSON.stringify({ name: 'npm', bin: { npm: 'bin/other.js' } }));
    assert.throws(() => validateNpmCli(cli), /does not match/);
    writeFileSync(metadata, JSON.stringify({ name: 'npm', bin: { npm: 'bin/npm-cli.js' } }));
    assert.equal(validateNpmCli(cli), cli);
    assert.equal(resolveNpmCli({ npm_execpath: cli }), cli);
    writeFileSync(join(root, 'bin', 'not-npm.js'), '');
    assert.throws(() => validateNpmCli(join(root, 'bin', 'not-npm.js')), /npm-cli.js/);
    assert.throws(() => resolveNpmCli({}, join(root, 'absent', 'node')), /unavailable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('npm resolution beside the actual Node runtime is independent of PATH', () => {
  const cli = resolveNpmCli({}, process.execPath);
  assert.equal(validateNpmCli(cli), cli);
});
