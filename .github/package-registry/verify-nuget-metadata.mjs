#!/usr/bin/env node
/**
 * Validate nuget-packages.json inventory against the SDK tree, release
 * workflow matrix, and (optionally) packed .nupkg nuspec metadata (OPS-725).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const INVENTORY_PATH = path.join(__dirname, 'nuget-packages.json');
const FORBIDDEN_ICONS = ['packagephoto.png', 'toggly_favicon.png'];

export function loadInventory(inventoryPath = INVENTORY_PATH) {
  return JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
}

function textContent(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function attrValue(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** Folder names listed as `project:` in the release workflow matrix. */
export function parseReleaseWorkflowProjects(workflowText) {
  const folders = [];
  for (const line of workflowText.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*project:\s*(\S+)\s*$/);
    if (m) folders.push(m[1]);
  }
  return folders;
}

export function projectFolder(projectRel) {
  return projectRel.split('/')[0];
}

/**
 * Inventory + source-tree + workflow matrix checks (no pack required).
 */
export function verifyNugetInventory(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const inventory = options.inventory || loadInventory(options.inventoryPath);
  const errors = [];

  const packages = inventory.packages || [];
  if (packages.length !== 11) {
    errors.push(`expected 11 packages, found ${packages.length}`);
  }

  const ids = packages.map((p) => p.id);
  if (new Set(ids).size !== ids.length) {
    errors.push('duplicate package ids in inventory');
  }

  const sdkRoot = path.join(repoRoot, inventory.sdkRoot || 'Toggly.FeatureManagement.NET');
  for (const pkg of packages) {
    const abs = path.join(sdkRoot, pkg.project);
    if (!fs.existsSync(abs)) {
      errors.push(`missing project for ${pkg.id}: ${pkg.project}`);
    }
  }

  const changelog = path.join(repoRoot, inventory.changelog || '');
  if (inventory.changelog && !fs.existsSync(changelog)) {
    errors.push(`missing changelog: ${inventory.changelog}`);
  }

  const workflowRel = inventory.workflow || '.github/workflows/sdk-dotnet-release.yml';
  const workflowPath = path.join(repoRoot, workflowRel);
  if (!fs.existsSync(workflowPath)) {
    errors.push(`missing workflow: ${workflowRel}`);
  } else {
    const workflowText = fs.readFileSync(workflowPath, 'utf8');
    const workflowFolders = parseReleaseWorkflowProjects(workflowText);
    const inventoryFolders = packages.map((p) => projectFolder(p.project));
    const sortedWf = [...workflowFolders].sort();
    const sortedInv = [...inventoryFolders].sort();
    if (JSON.stringify(sortedWf) !== JSON.stringify(sortedInv)) {
      errors.push(
        `sdk-dotnet-release.yml project folders drift from inventory:\n` +
          `  workflow: ${sortedWf.join(', ')}\n` +
          `  inventory: ${sortedInv.join(', ')}`,
      );
    }

    const folderToId = new Map(packages.map((p) => [projectFolder(p.project), p.id]));
    for (const folder of workflowFolders) {
      if (!folderToId.has(folder)) {
        errors.push(`workflow project folder has no inventory PackageId mapping: ${folder}`);
      }
    }
  }

  const iconRel = path.join(
    inventory.sdkRoot || 'Toggly.FeatureManagement.NET',
    'assets',
    inventory.packageIcon || 'toggly-package-icon.png',
  );
  if (!fs.existsSync(path.join(repoRoot, iconRel))) {
    errors.push(`missing shared package icon: ${iconRel}`);
  }

  return { ok: errors.length === 0, errors, inventory };
}

function listNupkgs(packDir) {
  return fs
    .readdirSync(packDir)
    .filter((f) => f.endsWith('.nupkg') && !f.endsWith('.snupkg'))
    .map((f) => path.join(packDir, f))
    .sort();
}

/** Match `PackageId.1.2.3.nupkg` without treating shorter ids as prefixes of longer ones. */
function matchPackageId(nupkgBasename, packageIds) {
  const sorted = [...packageIds].sort((a, b) => b.length - a.length);
  for (const id of sorted) {
    const escaped = id.replace(/\./g, '\\.');
    if (new RegExp(`^${escaped}\\.\\d`).test(nupkgBasename)) {
      return id;
    }
  }
  return null;
}

function normalizeUrl(url) {
  if (!url) return url;
  return url.replace(/\/+$/, '');
}

function extractNuspecAndEntries(nupkgPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-verify-'));
  try {
    execFileSync('unzip', ['-qq', nupkgPath, '-d', tmp], { stdio: 'pipe' });
    const entries = [];
    function walk(dir, prefix = '') {
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        if (fs.statSync(abs).isDirectory()) walk(abs, rel);
        else entries.push(rel.replace(/\\/g, '/'));
      }
    }
    walk(tmp);
    const nuspecName = entries.find((e) => e.endsWith('.nuspec'));
    if (!nuspecName) {
      return { entries, nuspec: null };
    }
    const nuspec = fs.readFileSync(path.join(tmp, nuspecName), 'utf8');
    return { entries, nuspec };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Inspect packed .nupkg files under NUGET_PACK_DIR / options.packDir.
 */
export function verifyPackedNupkgs(options = {}) {
  const inventory = options.inventory || loadInventory(options.inventoryPath);
  const packDir = options.packDir || process.env.NUGET_PACK_DIR;
  const errors = [];

  if (!packDir) {
    return { ok: false, errors: ['NUGET_PACK_DIR is not set'], skipped: true };
  }
  if (!fs.existsSync(packDir)) {
    return { ok: false, errors: [`pack dir does not exist: ${packDir}`] };
  }

  const nupkgs = listNupkgs(packDir);
  const expectedIds = new Set((inventory.packages || []).map((p) => p.id));
  const foundIds = new Set();

  for (const nupkg of nupkgs) {
    const base = path.basename(nupkg);
    const matchedId = matchPackageId(base, [...expectedIds]);
    if (!matchedId) {
      // Allow unrelated nupkgs in the folder; only enforce inventory packages.
      continue;
    }
    foundIds.add(matchedId);

    const { entries, nuspec } = extractNuspecAndEntries(nupkg);
    if (!nuspec) {
      errors.push(`${base}: missing nuspec`);
      continue;
    }

    const authors = textContent(nuspec, 'authors');
    const owners = textContent(nuspec, 'owners');
    const projectUrl = textContent(nuspec, 'projectUrl');
    const license = textContent(nuspec, 'license') || attrValue(nuspec, 'license', 'type');
    const licenseExpr =
      textContent(nuspec, 'license') ||
      (nuspec.match(/<license\s+type="expression"[^>]*>([^<]+)</i) || [])[1] ||
      null;
    const tags = (textContent(nuspec, 'tags') || '').split(/\s+/).filter(Boolean);
    const icon = textContent(nuspec, 'icon');
    const repoUrl =
      attrValue(nuspec, 'repository', 'url') || textContent(nuspec, 'repositoryUrl');

    if (authors !== inventory.authors) {
      errors.push(`${matchedId}: authors="${authors}" expected "${inventory.authors}"`);
    }
    // NuGet may omit owners or mirror authors; accept either missing or Toggly.
    if (owners != null && owners !== inventory.authors && owners !== inventory.company) {
      errors.push(`${matchedId}: owners="${owners}" expected "${inventory.authors}"`);
    }
    if (normalizeUrl(projectUrl) !== normalizeUrl(inventory.packageProjectUrl)) {
      errors.push(
        `${matchedId}: projectUrl="${projectUrl}" expected "${inventory.packageProjectUrl}"`,
      );
    }
    if (normalizeUrl(repoUrl) !== normalizeUrl(inventory.repositoryUrl)) {
      errors.push(
        `${matchedId}: repository url="${repoUrl}" expected "${inventory.repositoryUrl}"`,
      );
    }
    const licenseValue = (licenseExpr || license || '').trim();
    if (licenseValue !== inventory.license) {
      errors.push(`${matchedId}: license="${licenseValue}" expected "${inventory.license}"`);
    }
    if (icon !== inventory.packageIcon) {
      errors.push(`${matchedId}: icon="${icon}" expected "${inventory.packageIcon}"`);
    }
    for (const tag of inventory.requiredTags || []) {
      if (!tags.includes(tag)) {
        errors.push(`${matchedId}: missing required tag "${tag}" (have: ${tags.join(' ')})`);
      }
    }

    const entryLower = entries.map((e) => e.toLowerCase());
    for (const forbidden of FORBIDDEN_ICONS) {
      if (entryLower.some((e) => e === forbidden.toLowerCase() || e.endsWith(`/${forbidden.toLowerCase()}`))) {
        errors.push(`${matchedId}: packed package still contains ${forbidden}`);
      }
    }
    if (icon && FORBIDDEN_ICONS.includes(icon)) {
      errors.push(`${matchedId}: icon still references forbidden ${icon}`);
    }
    if (!entries.some((e) => e === inventory.packageIcon || e.endsWith(`/${inventory.packageIcon}`))) {
      errors.push(`${matchedId}: packed package missing icon file ${inventory.packageIcon}`);
    }
  }

  for (const id of expectedIds) {
    if (!foundIds.has(id)) {
      errors.push(`missing packed nupkg for ${id} in ${packDir}`);
    }
  }

  return { ok: errors.length === 0, errors, foundIds: [...foundIds].sort() };
}

export function verifyNugetMetadata(options = {}) {
  const inventoryResult = verifyNugetInventory(options);
  const errors = [...inventoryResult.errors];
  let packResult = null;

  if (options.packDir || process.env.NUGET_PACK_DIR) {
    packResult = verifyPackedNupkgs({
      ...options,
      inventory: inventoryResult.inventory,
    });
    if (!packResult.skipped) {
      errors.push(...packResult.errors);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    inventory: inventoryResult.inventory,
    pack: packResult,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyNugetMetadata();
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  console.log('nuget metadata contract ok');
}
