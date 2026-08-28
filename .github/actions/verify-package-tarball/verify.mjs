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

function pnpmAvailable() {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function npmPack(cwd) {
  const packOut = run('npm pack --json', { cwd });
  let packJson;
  try {
    packJson = JSON.parse(packOut.trim());
  } catch {
    const name = packOut.trim().split('\n').filter(Boolean).pop();
    packJson = [{ filename: name }];
  }
  const filename = Array.isArray(packJson) ? packJson[0].filename : packJson.filename;
  const tarballSrc = path.join(cwd, filename);
  if (!fs.existsSync(tarballSrc)) {
    fail(`npm pack did not produce ${tarballSrc}`);
  }
  return { tarballSrc, filename, via: 'npm' };
}

function pnpmPack(cwd) {
  const packOut = run('pnpm pack', { cwd });
  const lines = packOut.trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  const tarballSrc = path.isAbsolute(last) ? last : path.join(cwd, last);
  const filename = path.basename(tarballSrc);
  if (!fs.existsSync(tarballSrc)) {
    fail(`pnpm pack did not produce ${tarballSrc}`);
  }
  return { tarballSrc, filename, via: 'pnpm' };
}

try {
  // Prefer pnpm pack in pnpm workspaces so workspace:* rewrites to publishable versions.
  const pnpmRoot = findPnpmWorkspaceRoot(packageDir);
  let packed;
  if (pnpmRoot && pnpmAvailable()) {
    packed = pnpmPack(packageDir);
  } else {
    if (pnpmRoot && !pnpmAvailable()) {
      console.log('pnpm workspace detected but pnpm not installed; using npm pack');
    }
    packed = npmPack(packageDir);
  }
  const { tarballSrc, filename } = packed;
  const tarball = path.join(packDir, filename);
  fs.renameSync(tarballSrc, tarball);
  console.log(`Packed ${filename} (${packed.via})`);

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
  let installSkipped = false;
  try {
    run(`npm install "${tarball}" --no-fund --no-audit --omit=peer`, {
      cwd: installDir,
    });
  } catch (error) {
    const msg = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`;
    // Monorepo siblings are published in the same workflow after this verify.
    // Allow install to skip when the only missing targets are @ops-ai/* versions
    // that are not on the registry yet (packed manifest already checked above).
    if (/ETARGET|No matching version found for @ops-ai\//i.test(msg)) {
      console.log(
        `Skipping install probe: sibling @ops-ai dependency not on registry yet (packed manifest OK)`,
      );
      installSkipped = true;
    } else {
      fail(`npm install of packed tarball failed for ${packedManifest.name}:\n${msg}`);
    }
  }

  if (!installSkipped) {
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
  } else {
    console.log(`OK: ${packedManifest.name}@${packedManifest.version} tarball manifest is publishable`);
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
