#!/usr/bin/env node
/**
 * Unit tests for resolve-release-version logic (no network).
 * Run: node .github/actions/resolve-release-version/resolve.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolveScript = path.join(__dirname, 'resolve.mjs');

function writeTempPackageJson(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
  const manifestPath = path.join(dir, 'package.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ name: '@ops-ai/test-pkg', version }, null, 2)}\n`);
  return { dir, manifestPath };
}

function runResolve(env) {
  const outputFile = path.join(env.TMP_DIR, 'github_output');
  fs.writeFileSync(outputFile, '');
  execFileSync('node', [resolveScript], {
    cwd: env.TMP_DIR,
    env: { ...process.env, ...env, GITHUB_OUTPUT: outputFile },
    stdio: 'pipe',
  });
  const outputs = Object.fromEntries(
    fs.readFileSync(outputFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
  );
  return outputs;
}

function runResolveExpectFail(env) {
  const outputFile = path.join(env.TMP_DIR, 'github_output');
  fs.writeFileSync(outputFile, '');
  try {
    execFileSync('node', [resolveScript], {
      cwd: env.TMP_DIR,
      env: { ...process.env, ...env, GITHUB_OUTPUT: outputFile },
      stdio: 'pipe',
    });
    throw new Error('Expected resolve to fail');
  } catch (error) {
    if (error.message === 'Expected resolve to fail') {
      throw error;
    }
    return outputFile;
  }
}

// publish ahead of registry
{
  const { dir, manifestPath } = writeTempPackageJson('1.3.1');
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    PACKAGE_NAME: '@ops-ai/test-pkg',
    RELEASE_MODE: 'publish',
    BUMP_TYPE: 'patch',
  });
  assert.equal(outputs.action, 'publish');
  assert.equal(outputs.version, '1.3.1');
  fs.rmSync(dir, { recursive: true, force: true });
}

// publish equal -> skip (simulate registry via none + no tag)
{
  const { dir, manifestPath } = writeTempPackageJson('2.0.0');
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    PACKAGE_NAME: '@ops-ai/test-pkg',
    RELEASE_MODE: 'publish',
    BUMP_TYPE: 'patch',
  });
  assert.equal(outputs.action, 'publish');
  fs.rmSync(dir, { recursive: true, force: true });
}

// auto_bump updates manifest
{
  const { dir, manifestPath } = writeTempPackageJson('1.0.0');
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    PACKAGE_NAME: '@ops-ai/test-pkg',
    RELEASE_MODE: 'auto_bump',
    BUMP_TYPE: 'patch',
  });
  assert.equal(outputs.action, 'publish');
  assert.equal(outputs.version, '1.0.1');
  assert.equal(outputs.manifest_changed, 'true');
  const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(updated.version, '1.0.1');
  fs.rmSync(dir, { recursive: true, force: true });
}

// pubspec read
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
  const manifestPath = path.join(dir, 'pubspec.yaml');
  fs.writeFileSync(manifestPath, 'name: test\nversion: 0.5.2+1\n');
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    PACKAGE_NAME: 'test',
    RELEASE_MODE: 'publish',
  });
  assert.equal(outputs.manifest_version, '0.5.2');
  assert.equal(outputs.version, '0.5.2');
  fs.rmSync(dir, { recursive: true, force: true });
}

function initGitRepo(dir) {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README'), 'test\n');
  execFileSync('git', ['add', 'README'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
}

// legacy malformed tag suffix (cli-vv0.1.0) normalizes to 0.1.0
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
  const manifestPath = path.join(dir, 'VERSION');
  fs.writeFileSync(manifestPath, '0.1.0\n');
  initGitRepo(dir);
  execFileSync('git', ['tag', 'cli-vv0.1.0'], { cwd: dir });
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    TAG_PREFIX: 'cli-v',
    PACKAGE_NAME: 'toggly-cli',
    RELEASE_MODE: 'publish',
  });
  assert.equal(outputs.registry_latest, '0.1.0');
  assert.equal(outputs.action, 'skip');
  fs.rmSync(dir, { recursive: true, force: true });
}

// picks highest valid tag when multiple exist
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
  const manifestPath = path.join(dir, 'VERSION');
  fs.writeFileSync(manifestPath, '0.3.0\n');
  initGitRepo(dir);
  execFileSync('git', ['tag', 'cli-v0.1.0'], { cwd: dir });
  execFileSync('git', ['tag', 'cli-v0.2.0'], { cwd: dir });
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    TAG_PREFIX: 'cli-v',
    PACKAGE_NAME: 'toggly-cli',
    RELEASE_MODE: 'publish',
  });
  assert.equal(outputs.registry_latest, '0.2.0');
  assert.equal(outputs.action, 'publish');
  fs.rmSync(dir, { recursive: true, force: true });
}

// cargo workspace.package version read + auto_bump write
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
  const manifestPath = path.join(dir, 'Cargo.toml');
  fs.writeFileSync(
    manifestPath,
    `[workspace]
members = ["toggly"]

[workspace.package]
version = "0.1.0"
`,
  );
  const outputs = runResolve({
    TMP_DIR: dir,
    MANIFEST_PATH: manifestPath,
    REGISTRY: 'none',
    PACKAGE_NAME: 'toggly',
    RELEASE_MODE: 'auto_bump',
    BUMP_TYPE: 'patch',
  });
  assert.equal(outputs.version, '0.1.1');
  assert.match(fs.readFileSync(manifestPath, 'utf8'), /version = "0\.1\.1"/);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('resolve-release-version tests passed');
