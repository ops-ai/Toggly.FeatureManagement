import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const family = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'toggly-packed-native-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = temp) => execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, npm_config_cache: join(temp, 'npm-cache') } });
const shared = JSON.parse(process.env.TOGGLY_SHARED_ARTIFACTS ?? '[]');
if (!Array.isArray(shared) || shared.some(value => typeof value !== 'string')) throw new Error('TOGGLY_SHARED_ARTIFACTS must be a JSON string array');
try {
  cpSync(join(family, 'tests/fixtures/packed-native'), temp, { recursive: true });
  const archives = [];
  for (const name of ['core', 'react-native']) {
    const cwd = join(family, 'libs', name);
    run(npm, ['run', 'build'], cwd);
    const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(temp, 'npm-cache') } }));
    archives.push(join(temp, packed[0].filename));
  }
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...shared, ...archives]);
  run(join(temp, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--target', 'ES2020', '--module', 'Node16', '--moduleResolution', 'Node16', '--lib', 'ES2020', '--esModuleInterop', 'consumer.ts']);
  run(process.execPath, ['verify.cjs']);
  run(process.execPath, ['build.cjs']);
} finally { rmSync(temp, { recursive: true, force: true }); }
