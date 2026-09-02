#!/usr/bin/env node
/**
 * Discover public @ops-ai/* manifests and validate npm-packages.json inventory
 * plus the public metadata contract (OPS-727).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const INVENTORY_PATH = path.join(__dirname, 'npm-packages.json');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.worktrees',
  'coverage',
  'playground',
]);

export function loadInventory(inventoryPath = INVENTORY_PATH) {
  return JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
}

function shouldSkipDir(dirName) {
  return SKIP_DIR_NAMES.has(dirName) || dirName.toLowerCase().includes('example');
}

export function discoverPublicOpsAiManifests(repoRoot = REPO_ROOT, inventory = loadInventory()) {
  const exclude = new Set(inventory.excludeFromInventory || []);
  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (entry.name !== 'package.json') continue;
      const abs = path.join(dir, entry.name);
      let data;
      try {
        data = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch {
        continue;
      }
      const name = data.name || '';
      if (!name.startsWith('@ops-ai/')) continue;
      if (data.private === true) continue;
      if (exclude.has(name)) continue;
      found.push({
        name,
        manifest: path.relative(repoRoot, abs).split(path.sep).join('/'),
        data,
      });
    }
  }

  walk(repoRoot);
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

function authorMatches(author, expected) {
  if (typeof author === 'string') {
    return author.trim() === expected;
  }
  if (author && typeof author === 'object') {
    const name = (author.name || '').trim();
    const email = (author.email || '').trim();
    return `${name} <${email}>` === expected;
  }
  return false;
}

function forbiddenUrl(value) {
  if (!value || typeof value !== 'string') return false;
  return (
    value.includes('/tree/develop') ||
    value.includes('#develop') ||
    /Toggly\.FeatureManagement\/Toggly\.FeatureManagement/.test(value)
  );
}

const CARET_RANGE = /^\^\d+\.\d+\.\d+/;

/**
 * Nearest pnpm workspace root above a manifest, relative to the repo root.
 * Returns null when the package is not inside any pnpm workspace.
 */
export function findWorkspaceRoot(manifestPath, repoRoot = REPO_ROOT) {
  const root = path.resolve(repoRoot);
  let dir = path.dirname(path.resolve(root, manifestPath));

  while (dir.startsWith(root)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return path.relative(root, dir).split(path.sep).join('/') || '.';
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/** Maps every discovered repo package to its pnpm workspace root. */
export function buildWorkspaceIndex(discovered, repoRoot = REPO_ROOT) {
  return new Map(
    discovered.map((pkg) => [pkg.name, findWorkspaceRoot(pkg.manifest, repoRoot)]),
  );
}

/**
 * Enforces how one repo package may depend on another.
 *
 * `workspace:*` publishes as an exact pin, which is what stranded consumers on
 * two copies of a core package (OPS-820). A bare exact version does the same
 * damage, so ranges — not just the workspace protocol — are what we check.
 *
 * - Same pnpm workspace, runtime deps: must be `workspace:^`.
 * - Peer deps and cross-workspace deps: must be `workspace:^` or a caret range.
 */
export function validateIntraRepoDependencies(pkg, workspaceIndex) {
  const errors = [];
  const ownWorkspace = workspaceIndex.get(pkg.name) ?? null;
  const data = pkg.data || {};

  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = data[section];
    if (!deps || typeof deps !== 'object') continue;

    for (const [depName, specifier] of Object.entries(deps)) {
      if (!workspaceIndex.has(depName)) continue;

      const value = String(specifier);
      const sameWorkspace =
        ownWorkspace !== null && workspaceIndex.get(depName) === ownWorkspace;

      if (sameWorkspace && section !== 'peerDependencies') {
        if (value !== 'workspace:^') {
          errors.push(
            `${section}.${depName}: same-workspace repo deps must use workspace:^, got ${value}`,
          );
        }
        continue;
      }

      if (value === 'workspace:^' || CARET_RANGE.test(value)) continue;

      errors.push(
        `${section}.${depName}: repo deps must use workspace:^ or a caret range so installs dedupe, got ${value}`,
      );
    }
  }

  return errors;
}

export function validatePackageMetadata(pkg, inventory, data, workspaceIndex) {
  const errors = [];
  const { repositoryUrl, bugsUrl, author, license, requiredKeywords } = inventory;

  if (data.name !== pkg.name) {
    errors.push(`name: expected ${pkg.name}, got ${data.name}`);
  }
  if (!authorMatches(data.author, author)) {
    errors.push(`author: expected ${author}, got ${JSON.stringify(data.author)}`);
  }
  if (data.license !== license) {
    errors.push(`license: expected ${license}, got ${data.license}`);
  }
  if (data.homepage !== pkg.docsUrl) {
    errors.push(`homepage: expected ${pkg.docsUrl}, got ${data.homepage}`);
  }
  const repo = data.repository || {};
  const repoUrl = typeof repo === 'string' ? repo : repo.url;
  const repoDir = typeof repo === 'object' ? repo.directory : undefined;
  if (repoUrl !== repositoryUrl) {
    errors.push(`repository.url: expected ${repositoryUrl}, got ${repoUrl}`);
  }
  const expectedDir = path.dirname(pkg.manifest).split(path.sep).join('/');
  if (repoDir !== expectedDir) {
    errors.push(`repository.directory: expected ${expectedDir}, got ${repoDir}`);
  }
  const bugs = data.bugs || {};
  const bugsUrlActual = typeof bugs === 'string' ? bugs : bugs.url;
  if (bugsUrlActual !== bugsUrl) {
    errors.push(`bugs.url: expected ${bugsUrl}, got ${bugsUrlActual}`);
  }
  const publishAccess = data.publishConfig && data.publishConfig.access;
  if (publishAccess !== 'public') {
    errors.push(`publishConfig.access: expected public, got ${publishAccess}`);
  }
  const keywords = data.keywords || [];
  for (const kw of requiredKeywords || []) {
    if (!keywords.includes(kw)) {
      errors.push(`keywords: missing required "${kw}"`);
    }
  }
  for (const field of [data.homepage, repoUrl, bugsUrlActual]) {
    if (forbiddenUrl(field)) {
      errors.push(`forbidden develop/duplicated URL segment in metadata: ${field}`);
    }
  }
  if (workspaceIndex) {
    errors.push(
      ...validateIntraRepoDependencies(
        { name: pkg.name, manifest: pkg.manifest, data },
        workspaceIndex,
      ),
    );
  }
  return errors;
}

export function verifyNpmMetadata({ repoRoot = REPO_ROOT, inventoryPath = INVENTORY_PATH } = {}) {
  const inventory = loadInventory(inventoryPath);
  const errors = [];
  const discovered = discoverPublicOpsAiManifests(repoRoot, inventory);
  const workspaceIndex = buildWorkspaceIndex(discovered, repoRoot);
  const byName = new Map(inventory.packages.map((p) => [p.name, p]));

  if (!Array.isArray(inventory.packages) || inventory.packages.length === 0) {
    errors.push('npm-packages.json packages[] is empty');
  }

  for (const d of discovered) {
    const row = byName.get(d.name);
    if (!row) {
      errors.push(`discovered public package missing from inventory: ${d.name} (${d.manifest})`);
      continue;
    }
    if (row.manifest !== d.manifest) {
      errors.push(`${d.name}: inventory manifest ${row.manifest} != discovered ${d.manifest}`);
    }
  }

  const discoveredNames = new Set(discovered.map((d) => d.name));
  for (const pkg of inventory.packages) {
    if (!discoveredNames.has(pkg.name)) {
      errors.push(`inventory package not discovered on disk: ${pkg.name}`);
    }
    const manifestAbs = path.join(repoRoot, pkg.manifest);
    if (!fs.existsSync(manifestAbs)) {
      errors.push(`${pkg.name}: missing manifest ${pkg.manifest}`);
      continue;
    }
    const changelogAbs = path.join(repoRoot, pkg.changelog);
    if (!fs.existsSync(changelogAbs)) {
      errors.push(`${pkg.name}: missing changelog ${pkg.changelog}`);
    }
    const workflowAbs = path.join(repoRoot, pkg.workflow);
    if (!fs.existsSync(workflowAbs)) {
      errors.push(`${pkg.name}: missing workflow ${pkg.workflow}`);
    }
    const data = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
    errors.push(
      ...validatePackageMetadata(pkg, inventory, data, workspaceIndex).map(
        (e) => `${pkg.name}: ${e}`,
      ),
    );
  }

  return { ok: errors.length === 0, errors, discoveredCount: discovered.length, inventoryCount: inventory.packages.length };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyNpmMetadata();
  if (!result.ok) {
    console.error(`npm metadata contract failed (${result.errors.length} error(s)):`);
    for (const e of result.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`npm metadata contract ok (${result.inventoryCount} packages)`);
}
