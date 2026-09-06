#!/usr/bin/env node
/**
 * Contract checks for deterministic packs, centralized SourceLink, and
 * nupkg+snupkg signing coverage (OPS-943).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { loadInventory } from './verify-nuget-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SDK_ROOT = path.join(REPO_ROOT, 'Toggly.FeatureManagement.NET');
const DIRECTORY_BUILD_PROPS = path.join(SDK_ROOT, 'Directory.Build.props');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/sdk-dotnet-release.yml');

export const REQUIRED_NUGET_SIGN_SECRETS = [
  'NUGET_SIGN_VAULT_URL',
  'NUGET_SIGN_CLIENT_ID',
  'NUGET_SIGN_CLIENT_SECRET',
  'NUGET_SIGN_TENANT_ID',
  'NUGET_SIGN_CERTIFICATE',
  'NUGET_SIGN_CA_CHAIN_B64',
];

const HANGFIRE_ID = 'Toggly.FeatureManagement.Hangfire';
const ENTITY_FRAMEWORK_ID = 'Toggly.FeatureManagement.Storage.EntityFramework';

/**
 * Fail unless Directory.Build.props centralizes deterministic + SourceLink props.
 */
export function verifyDirectoryBuildSourceLink(options = {}) {
  const propsPath = options.directoryBuildProps || DIRECTORY_BUILD_PROPS;
  const errors = [];
  if (!fs.existsSync(propsPath)) {
    return { ok: false, errors: [`missing ${propsPath}`] };
  }

  const props = fs.readFileSync(propsPath, 'utf8');

  for (const prop of [
    'Deterministic',
    'PublishRepositoryUrl',
    'IncludeSymbols',
    'SymbolPackageFormat',
    'DebugType',
    'AllowedOutputExtensionsInPackageBuildOutputFolder',
  ]) {
    if (!new RegExp(`<${prop}>`, 'i').test(props)) {
      errors.push(`Directory.Build.props missing <${prop}>`);
    }
  }

  if (!/<Deterministic>\s*true\s*<\/Deterministic>/i.test(props)) {
    errors.push('Directory.Build.props must set Deterministic to true');
  }
  if (!/<PublishRepositoryUrl>\s*true\s*<\/PublishRepositoryUrl>/i.test(props)) {
    errors.push('Directory.Build.props must set PublishRepositoryUrl to true');
  }
  if (!/<IncludeSymbols>\s*true\s*<\/IncludeSymbols>/i.test(props)) {
    errors.push('Directory.Build.props must set IncludeSymbols to true');
  }
  if (!/<SymbolPackageFormat>\s*snupkg\s*<\/SymbolPackageFormat>/i.test(props)) {
    errors.push('Directory.Build.props must set SymbolPackageFormat to snupkg');
  }
  if (!/<DebugType>\s*portable\s*<\/DebugType>/i.test(props)) {
    errors.push('Directory.Build.props must set DebugType to portable');
  }
  if (!/\.pdb/.test(props) || !/AllowedOutputExtensionsInPackageBuildOutputFolder/.test(props)) {
    errors.push('Directory.Build.props must include .pdb in AllowedOutputExtensionsInPackageBuildOutputFolder');
  }

  if (!/Microsoft\.SourceLink\.GitHub/.test(props)) {
    errors.push('Directory.Build.props missing Microsoft.SourceLink.GitHub PackageReference');
  }

  // OPS-942 CI group must remain (not duplicated elsewhere as the sole path).
  if (!/GITHUB_ACTIONS/.test(props) || !/ContinuousIntegrationBuild/.test(props)) {
    errors.push('Directory.Build.props must retain ContinuousIntegrationBuild CI group (OPS-942)');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Fail if packable csproj still declare per-project SourceLink / symbol props.
 * Hangfire and EntityFramework must not be outliers after centralization.
 */
export function verifyPackableProjectsInheritSourceLink(options = {}) {
  const inventory = options.inventory || loadInventory(options.inventoryPath);
  const sdkRoot = options.sdkRoot || SDK_ROOT;
  const errors = [];
  const sourceLinkRef = /Microsoft\.SourceLink\.GitHub/;
  const symbolProps = /<(IncludeSymbols|SymbolPackageFormat)\b/i;

  const byId = new Map(inventory.packages.map((p) => [p.id, p]));
  for (const requiredId of [HANGFIRE_ID, ENTITY_FRAMEWORK_ID]) {
    if (!byId.has(requiredId)) {
      errors.push(`inventory missing required package id: ${requiredId}`);
    }
  }

  for (const pkg of inventory.packages) {
    const csprojPath = path.join(sdkRoot, pkg.project);
    if (!fs.existsSync(csprojPath)) {
      errors.push(`missing project for ${pkg.id}: ${pkg.project}`);
      continue;
    }
    const text = fs.readFileSync(csprojPath, 'utf8');
    if (sourceLinkRef.test(text)) {
      errors.push(`${pkg.project} still declares Microsoft.SourceLink.GitHub (must inherit from Directory.Build.props)`);
    }
    if (symbolProps.test(text)) {
      errors.push(`${pkg.project} still declares IncludeSymbols/SymbolPackageFormat (must inherit from Directory.Build.props)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Assert release workflow signs *.nupkg and *.snupkg and keeps NUGET_SIGN_* secrets.
 */
export function verifySigningWorkflow(options = {}) {
  const workflowPath = options.workflowPath || RELEASE_WORKFLOW;
  const errors = [];
  if (!fs.existsSync(workflowPath)) {
    return { ok: false, errors: [`missing workflow: ${workflowPath}`] };
  }

  const text = fs.readFileSync(workflowPath, 'utf8');

  if (!/NuGetKeyVaultSignTool\s+sign/.test(text)) {
    errors.push('sdk-dotnet-release.yml missing NuGetKeyVaultSignTool sign');
  }

  const signsNupkg =
    /\*\.nupkg/.test(text) ||
    /nupkgs\/\*\.nupkg/.test(text) ||
    /sign\s+\.\/nupkgs\/\*\.(nupkg|snupkg)/.test(text);
  const signsSnupkg =
    /\*\.snupkg/.test(text) ||
    /nupkgs\/\*\.snupkg/.test(text) ||
    /sign\s+\.\/nupkgs\/\*\.\*/.test(text);

  // Accept either explicit dual globs or a combined pattern covering both.
  const combinedGlob = /NuGetKeyVaultSignTool\s+sign\s+[^\n]*\*\.\{nupkg,snupkg\}/;
  const dualSign =
    (signsNupkg && signsSnupkg) ||
    combinedGlob.test(text) ||
    /NuGetKeyVaultSignTool\s+sign\s+[^\n]*nupkgs\/\*/.test(text);

  if (!dualSign) {
    errors.push(
      'sdk-dotnet-release.yml must sign both *.nupkg and *.snupkg (explicit globs or covering pattern)',
    );
  }

  for (const secret of REQUIRED_NUGET_SIGN_SECRETS) {
    if (!text.includes(secret)) {
      errors.push(`sdk-dotnet-release.yml missing secret reference: ${secret}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Optional dual-pack verification at the same commit.
 *
 * Whole `.nupkg` SHA-256 is intentionally NOT asserted: NuGet embeds fresh OPC
 * package GUIDs (`_rels/.rels`, `*.psmdcp`) and zip entry timestamps on each
 * pack, even with ContinuousIntegrationBuild. Signed packages additionally
 * differ due to RFC3161 timestamps.
 *
 * Instead assert:
 * - eleven nupkg + eleven snupkg each run
 * - identical non-empty repository commit in each nuspec
 * - identical SHA-256 for payload entries under lib/ (and contentFiles/analyzers when present)
 *
 * Enable with RUN_NUGET_DUAL_PACK=1 (slow; local/release verification).
 */
export function verifyDualPackHashes(options = {}) {
  if (!options.force && process.env.RUN_NUGET_DUAL_PACK !== '1') {
    return {
      ok: true,
      skipped: true,
      note:
        'Whole-nupkg SHA-256 is not byte-stable (NuGet OPC GUIDs / zip timestamps); ' +
        'signed packages also differ due to RFC3161. Dual-pack asserts stable ' +
        'RepositoryCommit + lib/ payload hashes when RUN_NUGET_DUAL_PACK=1.',
    };
  }

  const sdkRoot = options.sdkRoot || SDK_ROOT;
  const sln = path.join(sdkRoot, 'Toggly.FeatureManagement.sln');
  const errors = [];
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-nuget-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-nuget-b-'));

  const packEnv = { ...process.env, GITHUB_ACTIONS: 'true' };

  try {
    execFileSync(
      'dotnet',
      [
        'build',
        sln,
        '-c',
        'Release',
        '--nologo',
        '-p:ContinuousIntegrationBuild=true',
        '-p:EmbedUntrackedSources=true',
      ],
      { cwd: sdkRoot, stdio: 'pipe', env: packEnv },
    );
    for (const outDir of [dirA, dirB]) {
      execFileSync(
        'dotnet',
        [
          'pack',
          sln,
          '-c',
          'Release',
          '--no-build',
          '--nologo',
          '--output',
          outDir,
          '-p:ContinuousIntegrationBuild=true',
        ],
        { cwd: sdkRoot, stdio: 'pipe', env: packEnv },
      );
    }

    const nupkgsA = fs.readdirSync(dirA).filter((f) => f.endsWith('.nupkg')).sort();
    const nupkgsB = fs.readdirSync(dirB).filter((f) => f.endsWith('.nupkg')).sort();

    if (nupkgsA.length !== 11) {
      errors.push(`first pack produced ${nupkgsA.length} nupkgs, expected 11`);
    }
    if (JSON.stringify(nupkgsA) !== JSON.stringify(nupkgsB)) {
      errors.push(`pack file lists differ:\n  A: ${nupkgsA.join(', ')}\n  B: ${nupkgsB.join(', ')}`);
    }

    const snupkgs = fs.readdirSync(dirA).filter((f) => f.endsWith('.snupkg'));
    if (snupkgs.length !== 11) {
      errors.push(`first pack produced ${snupkgs.length} snupkgs, expected 11`);
    }

    for (const name of nupkgsA) {
      const pathA = path.join(dirA, name);
      const pathB = path.join(dirB, name);
      if (!fs.existsSync(pathB)) {
        errors.push(`second pack missing ${name}`);
        continue;
      }

      const commitA = extractRepositoryCommit(pathA);
      const commitB = extractRepositoryCommit(pathB);
      if (!commitA) {
        errors.push(`${name}: missing repository commit in first pack nuspec`);
      } else if (commitA !== commitB) {
        errors.push(`${name}: RepositoryCommit drift ${commitA} vs ${commitB}`);
      }

      const payloadA = payloadEntryHashes(pathA);
      const payloadB = payloadEntryHashes(pathB);
      const keys = new Set([...Object.keys(payloadA), ...Object.keys(payloadB)]);
      if (keys.size === 0) {
        errors.push(`${name}: no lib/contentFiles/analyzers payload entries found`);
      }
      for (const key of [...keys].sort()) {
        if (payloadA[key] !== payloadB[key]) {
          errors.push(`${name}: payload hash mismatch for ${key}`);
        }
      }
    }
  } catch (err) {
    errors.push(`dual-pack failed: ${err.message || err}`);
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }

  return { ok: errors.length === 0, errors, skipped: false };
}

function extractRepositoryCommit(nupkgPath) {
  // Lightweight: unzip -p via child_process would work; use built-in via exec
  // of `unzip -p` for portability without extra deps.
  try {
    const nuspec = execFileSync('unzip', ['-p', nupkgPath, '*.nuspec'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const m = nuspec.match(/\bcommit="([0-9a-fA-F]{7,40})"/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function payloadEntryHashes(nupkgPath) {
  const listing = execFileSync('unzip', ['-Z1', nupkgPath], { encoding: 'utf8' });
  const entries = listing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (e) =>
        e &&
        (e.startsWith('lib/') ||
          e.startsWith('content/') ||
          e.startsWith('contentFiles/') ||
          e.startsWith('analyzers/') ||
          e.startsWith('build/') ||
          e.startsWith('buildTransitive/')),
    );
  const hashes = {};
  for (const entry of entries) {
    if (entry.endsWith('/')) continue;
    const data = execFileSync('unzip', ['-p', nupkgPath, entry]);
    hashes[entry] = crypto.createHash('sha256').update(data).digest('hex');
  }
  return hashes;
}

/**
 * When NUGET_PACK_DIR is set, require eleven snupkgs alongside nupkgs.
 */
export function verifyPackedSymbols(options = {}) {
  const packDir = options.packDir || process.env.NUGET_PACK_DIR;
  if (!packDir) {
    return { ok: true, skipped: true };
  }
  if (!fs.existsSync(packDir)) {
    return { ok: false, errors: [`NUGET_PACK_DIR does not exist: ${packDir}`] };
  }

  const inventory = options.inventory || loadInventory(options.inventoryPath);
  const errors = [];
  const files = fs.readdirSync(packDir);
  const nupkgs = files.filter((f) => f.endsWith('.nupkg') && !f.endsWith('.snupkg'));
  const snupkgs = files.filter((f) => f.endsWith('.snupkg'));

  if (nupkgs.length !== 11) {
    errors.push(`expected 11 nupkgs in ${packDir}, found ${nupkgs.length}`);
  }
  if (snupkgs.length !== 11) {
    errors.push(`expected 11 snupkgs in ${packDir}, found ${snupkgs.length}`);
  }

  for (const pkg of inventory.packages) {
    const hasNupkg = nupkgs.some((f) => f.startsWith(`${pkg.id}.`) && f.endsWith('.nupkg'));
    const hasSnupkg = snupkgs.some((f) => f.startsWith(`${pkg.id}.`) && f.endsWith('.snupkg'));
    if (!hasNupkg) errors.push(`missing nupkg for ${pkg.id}`);
    if (!hasSnupkg) errors.push(`missing snupkg for ${pkg.id}`);
  }

  return { ok: errors.length === 0, errors, skipped: false };
}

export function verifyNugetSourceLink(options = {}) {
  const errors = [];
  for (const result of [
    verifyDirectoryBuildSourceLink(options),
    verifyPackableProjectsInheritSourceLink(options),
    verifySigningWorkflow(options),
    verifyPackedSymbols(options),
    verifyDualPackHashes(options),
  ]) {
    if (result.skipped) continue;
    errors.push(...(result.errors || []));
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyNugetSourceLink();
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exit(1);
  }
  console.log('NuGet SourceLink / signing contracts OK');
}
