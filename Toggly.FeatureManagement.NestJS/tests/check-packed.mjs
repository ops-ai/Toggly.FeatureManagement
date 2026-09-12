// Verify the shipped package in an isolated consumer, never through workspace
// imports. An unpublished reviewed core artifact may be injected for local
// dependency stabilization only; no artifact paths enter committed manifests.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const nestVersion = require('@nestjs/common/package.json').version;
const temp = mkdtempSync(join(tmpdir(), 'toggly-nest-packed-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: process.env, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result.stdout;
}
try {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: packageRoot, env: process.env, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || 'npm pack failed');
  const artifact = join(temp, JSON.parse(packed.stdout)[0].filename);
  const consumer = join(temp, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const packages = [artifact, `@nestjs/common@${nestVersion}`, `@nestjs/core@${nestVersion}`, `@nestjs/testing@${nestVersion}`, `@nestjs/platform-express@${nestVersion}`, 'reflect-metadata@^0.2.2', 'rxjs@^7.8.2', 'ws@^8.0.0'];
  if (process.env.TOGGLY_TEST_CORE_TARBALL) packages.push(resolve(process.env.TOGGLY_TEST_CORE_TARBALL));
  run('npm', ['install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', ...packages], consumer);
  for (const name of ['canonical-contract.mjs', 'packed-consumer.mjs']) cpSync(join(packageRoot, 'tests', name), join(consumer, name));
  cpSync(join(packageRoot, 'tests', 'fixtures'), join(consumer, 'fixtures'), { recursive: true });
  const core = JSON.parse(readFileSync(join(consumer, 'node_modules/@ops-ai/toggly-node-core/package.json'), 'utf8'));
  console.log(JSON.stringify({ packedAdapter: JSON.parse(packed.stdout)[0].name, core: core.version, nest: nestVersion, runtime: process.version, dependencySource: process.env.TOGGLY_TEST_CORE_TARBALL ? 'reviewed local artifact' : 'public registry' }));
  run(process.execPath, ['packed-consumer.mjs'], consumer);
  run(process.execPath, ['packed-consumer.mjs', '--cjs'], consumer);
} finally { rmSync(temp, { recursive: true, force: true }); }
