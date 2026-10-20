import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  findPublishableLockfileViolations,
  findReleaseBlockingLockfileViolations,
  isRegistryLockResolution,
  resolvedEscapesSdkRoot,
  scanNpmPackageLock,
  scanPnpmLock,
} from './refuse-publishable-lockfile-local-paths.mjs';

test('isRegistryLockResolution accepts https tarball URLs only', () => {
  assert.equal(isRegistryLockResolution('file:../pkg.tgz'), false);
  assert.equal(isRegistryLockResolution('../toggly-segments'), false);
  assert.equal(
    isRegistryLockResolution('https://registry.npmjs.org/@ops-ai/foo/-/foo-1.0.0.tgz'),
    true,
  );
});

test('resolvedEscapesSdkRoot allows intra-SDK workspace links', () => {
  const repoRoot = '/repo';
  assert.equal(
    resolvedEscapesSdkRoot({
      repoRoot,
      packageDir: '/repo/Toggly.FeatureManagement.ReactNative/libs/react-native',
      sdkRootRel: 'Toggly.FeatureManagement.ReactNative',
      resolved: '../core',
    }),
    false,
  );
  assert.equal(
    resolvedEscapesSdkRoot({
      repoRoot,
      packageDir: '/repo/Toggly.FeatureManagement.Astro',
      sdkRootRel: 'Toggly.FeatureManagement.Astro',
      resolved: '../toggly-segments',
    }),
    true,
  );
});

test('scanNpmPackageLock reports node_modules entries with ../ resolved paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'lock-guard-'));
  const sdkDir = join(root, 'Toggly.FeatureManagement.Astro');
  mkdirSync(sdkDir, { recursive: true });
  const lockPath = join(sdkDir, 'package-lock.json');
  writeFileSync(
    lockPath,
    JSON.stringify({
      packages: {
        'node_modules/@ops-ai/toggly-segments': { resolved: '../toggly-segments', version: '0.1.0' },
        'node_modules/lodash': {
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.0.0.tgz',
          version: '4.0.0',
        },
      },
    }),
  );
  const violations = scanNpmPackageLock(lockPath, {
    repoRoot: root,
    manifestRel: 'Toggly.FeatureManagement.Astro/package.json',
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /@ops-ai\/toggly-segments/);
  rmSync(root, { recursive: true, force: true });
});

test('scanPnpmLock reports link:../ importer entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-guard-'));
  const sdkDir = join(root, 'Toggly.FeatureManagement.Next');
  mkdirSync(sdkDir, { recursive: true });
  const lockPath = join(sdkDir, 'pnpm-lock.yaml');
  writeFileSync(
    lockPath,
    `importers:
  nextjs-toggly-server:
    dependencies:
      '@ops-ai/toggly-segments':
        specifier: workspace:^
        version: link:../../toggly-segments
`,
  );
  const violations = scanPnpmLock(lockPath, {
    repoRoot: root,
    sdkRootRel: 'Toggly.FeatureManagement.Next',
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /toggly-segments/);
  rmSync(root, { recursive: true, force: true });
});

test('toggly-segments consumer lockfiles resolve from the npm registry', () => {
  const violations = findPublishableLockfileViolations().filter((line) =>
    line.includes('toggly-segments'),
  );
  assert.deepEqual(violations, []);
});

test('release-blocking scan passes for toggly-segments consumers', () => {
  assert.deepEqual(findReleaseBlockingLockfileViolations(), []);
});
