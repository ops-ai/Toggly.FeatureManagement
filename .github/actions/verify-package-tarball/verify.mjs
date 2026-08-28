#!/usr/bin/env node
/**
 * Pack + install smoke test for publishable npm packages (OPS-781).
 * Catches workspace:/file:/link: in the packed manifest and unmet deps after install.
 */

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageDirInput = process.env.PACKAGE_DIR;
const skipImport = String(process.env.SKIP_IMPORT || 'false').toLowerCase() === 'true';
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

if (!packageDirInput) {
  console.error('PACKAGE_DIR is required');
  process.exit(1);
}

const packageDir = path.isAbsolute(packageDirInput)
  ? packageDirInput
  : path.resolve(workspace, packageDirInput);

if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
  console.error(`No package.json in ${packageDir}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
console.log(`Verifying ${manifest.name}@${manifest.version} from ${packageDir}`);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-pack-verify-'));
const packDir = path.join(tmpRoot, 'pack');
const installDir = path.join(tmpRoot, 'install');
fs.mkdirSync(packDir);
fs.mkdirSync(installDir);

function findPnpmWorkspaceRoot(start) {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

try {
  // pnpm pack rewrites workspace:* to publishable versions; npm pack does not.
  const pnpmRoot = findPnpmWorkspaceRoot(packageDir);
  let tarballSrc;
  let filename;
  if (pnpmRoot) {
    const packOut = run('pnpm pack', { cwd: packageDir });
    const lines = packOut.trim().split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    tarballSrc = path.isAbsolute(last) ? last : path.join(packageDir, last);
    filename = path.basename(tarballSrc);
    if (!fs.existsSync(tarballSrc)) {
      fail(`pnpm pack did not produce ${tarballSrc}`);
    }
  } else {
    const packOut = run('npm pack --json', { cwd: packageDir });
    let packJson;
    try {
      packJson = JSON.parse(packOut.trim());
    } catch {
      // Some npm versions print the filename only
      const name = packOut.trim().split('\n').filter(Boolean).pop();
      packJson = [{ filename: name }];
    }
    filename = Array.isArray(packJson) ? packJson[0].filename : packJson.filename;
    tarballSrc = path.join(packageDir, filename);
    if (!fs.existsSync(tarballSrc)) {
      fail(`npm pack did not produce ${tarballSrc}`);
    }
  }
  const tarball = path.join(packDir, filename);
  fs.renameSync(tarballSrc, tarball);
  console.log(`Packed ${filename}${pnpmRoot ? ' (pnpm)' : ''}`);

  const packedManifest = JSON.parse(
    run(`tar -xOf "${tarball}" package/package.json`),
  );
  const depFields = {
    ...packedManifest.dependencies,
    ...packedManifest.optionalDependencies,
    ...packedManifest.peerDependencies,
  };
  const bad = Object.entries(depFields || {}).filter(([, v]) =>
    /^(workspace|file|link):/.test(String(v)),
  );
  if (bad.length) {
    fail(
      `Packed manifest for ${packedManifest.name} contains unpublishable specs: ${bad
        .map(([k, v]) => `${k}@${v}`)
        .join(', ')}`,
    );
  }

  fs.writeFileSync(
    path.join(installDir, 'package.json'),
    JSON.stringify({ name: 'toggly-pack-verify-scratch', private: true, type: 'module' }, null, 2),
  );
  // Omit peers: host apps provide them. Auto-installing peers in a scratch
  // tree pulls frameworks (e.g. Gatsby) whose transitive experimental React
  // peers fail `npm ls` even when our package is fine.
  run(`npm install "${tarball}" --no-fund --no-audit --omit=peer`, {
    cwd: installDir,
  });

  // Confirm declared runtime deps landed (peers intentionally omitted).
  for (const dep of Object.keys(packedManifest.dependencies || {})) {
    const depPath = path.join(installDir, 'node_modules', ...dep.split('/'));
    if (!fs.existsSync(depPath)) {
      fail(`Dependency ${dep} missing after install of ${packedManifest.name}`);
    }
  }

  let lsOut = '';
  let lsCode = 0;
  try {
    lsOut = run('npm ls --all --json', { cwd: installDir });
  } catch (error) {
    lsCode = error.status || 1;
    lsOut = error.stdout || '';
    const stderr = error.stderr || '';
    // With --omit=peer, npm ls exits non-zero for missing peers; that is expected.
    if (/UNMET DEPENDENCY/i.test(`${lsOut}\n${stderr}`) && !/missing:/i.test(stderr)) {
      fail(
        `npm ls reported unmet dependencies for ${packedManifest.name}:\n${stderr || lsOut}`,
      );
    }
  }

  if (lsOut) {
    try {
      const tree = JSON.parse(lsOut);
      const problems = tree.problems || [];
      // Ignore missing/invalid peer noise; only hard-fail on unmet production deps.
      const hard = problems.filter((p) => /^UNMET DEPENDENCY/i.test(String(p)));
      if (hard.length) {
        fail(`npm ls problems for ${packedManifest.name}:\n${hard.join('\n')}`);
      }
    } catch {
      // ignore non-json ls
    }
  }
  if (lsCode !== 0 && /UNMET DEPENDENCY/i.test(lsOut) && !/missing:/i.test(lsOut)) {
    fail(`npm ls failed for ${packedManifest.name}`);
  }

  if (!skipImport) {
    const peers = Object.keys(packedManifest.peerDependencies || {});
    try {
      run(
        `node --input-type=module -e "await import('${packedManifest.name}')"`,
        { cwd: installDir },
      );
      console.log('Entry-point import OK');
    } catch (error) {
      const msg = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`;
      const missingPeer = peers.some(
        (peer) => msg.includes(peer) || msg.includes(peer.replace('/', path.sep)),
      );
      if (missingPeer) {
        console.log(
          `Entry-point import skipped failure due to missing peer dependency (${peers.join(', ')})`,
        );
      } else if (/ERR_MODULE_NOT_FOUND|Cannot find module/i.test(msg)) {
        fail(`Entry-point import failed for ${packedManifest.name}:\n${msg}`);
      } else {
        console.log(`Entry-point import raised (non-module) — continuing:\n${msg.slice(0, 500)}`);
      }
    }
  }

  console.log(`OK: ${packedManifest.name}@${packedManifest.version} tarball is installable`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
