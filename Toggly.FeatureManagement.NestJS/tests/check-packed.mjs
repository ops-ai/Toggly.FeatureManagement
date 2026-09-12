// Verify the shipped package in an isolated consumer, never through workspace
// imports. An unpublished reviewed core artifact may be injected for local
// dependency stabilization only; no artifact paths enter committed manifests.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync, realpathSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const nestVersion = require('@nestjs/common/package.json').version;
function validateNpmCli(candidate) {
  if (!isAbsolute(candidate)) throw new Error('npm CLI path must be absolute');
  let cli;
  try { cli = realpathSync(candidate); }
  catch { throw new Error(`npm CLI is unavailable: ${candidate}`); }
  if (basename(cli) !== 'npm-cli.js' || !statSync(cli).isFile()) {
    throw new Error('npm CLI must be an npm-cli.js file');
  }
  const npmRoot = resolve(dirname(cli), '..');
  let metadata;
  try { metadata = JSON.parse(readFileSync(join(npmRoot, 'package.json'), 'utf8')); }
  catch { throw new Error(`npm CLI package metadata is unavailable: ${npmRoot}`); }
  if (metadata.name !== 'npm' || typeof metadata.bin?.npm !== 'string' ||
      resolve(npmRoot, metadata.bin.npm) !== cli) {
    throw new Error('npm CLI does not match the npm package executable');
  }
  return cli;
}
function resolveNpmCli() {
  // npm run supplies its own executable. Direct Node invocation uses only the
  // npm bundled beside that runtime, never a program found by searching PATH.
  if (process.env.npm_execpath) return validateNpmCli(process.env.npm_execpath);
  const runtimeDirectory = dirname(process.execPath);
  const candidates = [
    join(runtimeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(runtimeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const candidate = candidates.find(path => existsSync(path));
  if (!candidate) throw new Error(`npm CLI is unavailable for Node runtime: ${process.execPath}`);
  return validateNpmCli(candidate);
}
const npmCli = resolveNpmCli();
const temp = mkdtempSync(join(tmpdir(), 'toggly-nest-packed-'));
function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, env: process.env, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Node child process exited ${result.status}`);
  return result.stdout;
}
try {
  const packed = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', temp], { cwd: packageRoot, env: process.env, encoding: 'utf8' });
  if (packed.status !== 0) throw new Error(packed.stderr || 'npm pack failed');
  const artifact = join(temp, JSON.parse(packed.stdout)[0].filename);
  const consumer = join(temp, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const packages = [artifact, `@nestjs/common@${nestVersion}`, `@nestjs/core@${nestVersion}`, `@nestjs/testing@${nestVersion}`, `@nestjs/platform-express@${nestVersion}`, 'reflect-metadata@^0.2.2', 'rxjs@^7.8.2', 'ws@^8.0.0'];
  if (process.env.TOGGLY_TEST_CORE_TARBALL) packages.push(resolve(process.env.TOGGLY_TEST_CORE_TARBALL));
  run([npmCli, 'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', ...packages], consumer);
  for (const name of ['canonical-contract.mjs', 'packed-consumer.mjs']) cpSync(join(packageRoot, 'tests', name), join(consumer, name));
  cpSync(join(packageRoot, 'tests', 'fixtures'), join(consumer, 'fixtures'), { recursive: true });
  const core = JSON.parse(readFileSync(join(consumer, 'node_modules/@ops-ai/toggly-node-core/package.json'), 'utf8'));
  console.log(JSON.stringify({ packedAdapter: JSON.parse(packed.stdout)[0].name, core: core.version, nest: nestVersion, runtime: process.version, dependencySource: process.env.TOGGLY_TEST_CORE_TARBALL ? 'reviewed local artifact' : 'public registry' }));
  run(['packed-consumer.mjs'], consumer);
  run(['packed-consumer.mjs', '--cjs'], consumer);
} finally { rmSync(temp, { recursive: true, force: true }); }
