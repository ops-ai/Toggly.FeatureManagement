#!/usr/bin/env node
/**
 * Fail when a publishable @ops-ai package lockfile resolves dependencies via
 * monorepo-relative paths (../) or file:/link: URLs instead of the registry.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPublicOpsAiManifests } from '../package-registry/verify-npm-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export function isRegistryLockResolution(resolved) {
  if (resolved == null || resolved === '') return true;
  const value = String(resolved);
  if (/^(file|link):/i.test(value)) return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return true;
  return false;
}

export function resolveSdkRoot(manifestRel) {
  const top = manifestRel.split('/')[0];
  if (top.startsWith('Toggly.FeatureManagement.')) return top;
  if (top.startsWith('toggly-')) return top;
  return path.dirname(manifestRel);
}

export function resolvedEscapesSdkRoot({ repoRoot, packageDir, sdkRootRel, resolved }) {
  if (resolved == null || resolved === '') return false;
  const value = String(resolved);
  if (/^(file|link):/i.test(value)) return true;
  if (!value.startsWith('../') && !value.startsWith('./')) return false;
  const sdkAbs = path.join(repoRoot, sdkRootRel);
  const targetAbs = path.normalize(path.join(packageDir, value));
  return !(targetAbs === sdkAbs || targetAbs.startsWith(`${sdkAbs}${path.sep}`));
}

export function scanNpmPackageLock(lockPath, { repoRoot = REPO_ROOT, manifestRel } = {}) {
  const violations = [];
  const packageDir = path.dirname(lockPath);
  const sdkRootRel = resolveSdkRoot(manifestRel || path.relative(repoRoot, lockPath));
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    violations.push(`${lockPath}: unreadable package-lock.json (${error.message})`);
    return violations;
  }
  const packages = lock.packages || {};
  for (const [key, entry] of Object.entries(packages)) {
    if (!entry || typeof entry !== 'object') continue;
    const resolved = entry.resolved;
    if (isRegistryLockResolution(resolved)) continue;
    if (!resolvedEscapesSdkRoot({ repoRoot, packageDir, sdkRootRel, resolved })) continue;
    const name = key.startsWith('node_modules/') ? key.slice('node_modules/'.length) : key;
    violations.push(`${lockPath}: ${name} resolves to ${resolved}`);
  }
  return violations;
}

export function scanPnpmLock(lockPath, { repoRoot = REPO_ROOT, sdkRootRel } = {}) {
  const violations = [];
  const text = fs.readFileSync(lockPath, 'utf8');
  const lockDir = path.dirname(lockPath);
  const lines = text.split('\n');
  let currentDependency = null;

  for (const line of lines) {
    const importerMatch = line.match(/^  (\.\.\/[^:]+):\s*$/);
    if (importerMatch) {
      const target = importerMatch[1];
      if (resolvedEscapesSdkRoot({ repoRoot, packageDir: lockDir, sdkRootRel, resolved: target })) {
        violations.push(`${lockPath}: pnpm importer links to ${target}`);
      }
      currentDependency = null;
      continue;
    }

    const dependencyKeyMatch = line.match(/^      '([^']+)':\s*$/);
    if (dependencyKeyMatch) {
      currentDependency = dependencyKeyMatch[1];
      continue;
    }

    const linkVersionMatch = line.match(/^        version: link:(\.\.\/[^\s#]+)/);
    if (linkVersionMatch && currentDependency) {
      const target = linkVersionMatch[1];
      if (resolvedEscapesSdkRoot({ repoRoot, packageDir: lockDir, sdkRootRel, resolved: target })) {
        violations.push(`${lockPath}: ${currentDependency} links to ${target}`);
      }
      currentDependency = null;
    }
  }

  return violations;
}

/** Violations that block release (segments must come from the public registry). */
export function isReleaseBlockingLockfileViolation(line) {
  return line.includes('toggly-segments');
}

export function findReleaseBlockingLockfileViolations(repoRoot = REPO_ROOT) {
  return findPublishableLockfileViolations(repoRoot).filter(isReleaseBlockingLockfileViolation);
}

export function findPublishableLockfileViolations(repoRoot = REPO_ROOT) {
  const manifests = discoverPublicOpsAiManifests(repoRoot);
  const violations = [];
  const seenLocks = new Set();

  for (const { manifest } of manifests) {
    const sdkRootRel = resolveSdkRoot(manifest);
    const packageDir = path.dirname(path.join(repoRoot, manifest));
    const npmLock = path.join(packageDir, 'package-lock.json');
    if (fs.existsSync(npmLock) && !seenLocks.has(npmLock)) {
      seenLocks.add(npmLock);
      violations.push(...scanNpmPackageLock(npmLock, { repoRoot, manifestRel: manifest }));
    }
  }

  const pnpmRoots = new Map();
  for (const { manifest } of manifests) {
    const abs = path.join(repoRoot, manifest);
    let dir = path.dirname(abs);
    const sdkRootRel = resolveSdkRoot(manifest);
    while (dir !== repoRoot && dir.startsWith(repoRoot)) {
      const candidate = path.join(dir, 'pnpm-lock.yaml');
      if (fs.existsSync(candidate)) {
        pnpmRoots.set(candidate, sdkRootRel);
        break;
      }
      dir = path.dirname(dir);
    }
  }

  for (const [lockPath, sdkRootRel] of pnpmRoots) {
    violations.push(...scanPnpmLock(lockPath, { repoRoot, sdkRootRel }));
  }

  return violations;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const segmentsOnly = process.argv.includes('--release-blocking');
  const violations = segmentsOnly
    ? findReleaseBlockingLockfileViolations()
    : findPublishableLockfileViolations();
  if (violations.length > 0) {
    console.error('Refusing publishable lockfiles with local-path resolutions:');
    for (const line of violations) console.error(` - ${line}`);
    process.exit(1);
  }
  console.log(
    segmentsOnly
      ? 'Publishable lockfiles resolve @ops-ai/toggly-segments from the registry.'
      : 'Publishable lockfiles resolve registry dependencies only.',
  );
}
