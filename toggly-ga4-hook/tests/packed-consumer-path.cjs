const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { npmCommand } = require('./npm-command.cjs');

test('builds a shell-free npm command on Windows', () => {
  const nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe';
  assert.deepEqual(npmCommand(['--version'], { platform: 'win32', nodeExecutable }), {
    executable: nodeExecutable,
    args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', '--version'],
  });
});

const packageDirectory = path.resolve(__dirname, '..');
const fakeNpmDirectory = mkdtempSync(path.join(os.tmpdir(), 'toggly-fake-npm-'));
const npmCacheDirectory = mkdtempSync(path.join(os.tmpdir(), 'toggly-ga4-hook-npm-cache-'));
const fakeNpm = path.join(fakeNpmDirectory, process.platform === 'win32' ? 'npm.cmd' : 'npm');

writeFileSync(fakeNpm, process.platform === 'win32' ? '@exit /b 97\r\n' : '#!/bin/sh\nexit 97\n');
if (process.platform !== 'win32') {
  chmodSync(fakeNpm, 0o755);
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'packed-consumer.cjs')], {
    cwd: packageDirectory,
    env: {
      ...process.env,
      PATH: `${fakeNpmDirectory}${path.delimiter}${process.env.PATH}`,
      npm_config_cache: npmCacheDirectory,
    },
    stdio: 'inherit',
  });
} finally {
  rmSync(fakeNpmDirectory, { recursive: true, force: true });
  rmSync(npmCacheDirectory, { recursive: true, force: true });
}
