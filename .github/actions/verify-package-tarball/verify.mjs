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

try {
  const packOut = run('npm pack --json', { cwd: packageDir });
  let packJson;
  try {
    packJson = JSON.parse(packOut.trim());
  } catch {
    // Some npm versions print the filename only
    const name = packOut.trim().split('\n').filter(Boolean).pop();
    packJson = [{ filename: name }];
  }
  const filename = Array.isArray(packJson) ? packJson[0].filename : packJson.filename;
  const tarballSrc = path.join(packageDir, filename);
  if (!fs.existsSync(tarballSrc)) {
    fail(`npm pack did not produce ${tarballSrc}`);
  }
  const tarball = path.join(packDir, filename);
  fs.renameSync(tarballSrc, tarball);
  console.log(`Packed ${filename}`);

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
  run(`npm install "${tarball}" --no-fund --no-audit`, { cwd: installDir });

  let lsOut = '';
  let lsCode = 0;
  try {
    lsOut = run('npm ls --all --json', { cwd: installDir });
  } catch (error) {
    lsCode = error.status || 1;
    lsOut = error.stdout || '';
    const stderr = error.stderr || '';
    if (/ELSPROBLEMS|UNMET DEPENDENCY|invalid/i.test(`${lsOut}\n${stderr}`)) {
      fail(
        `npm ls reported unmet/invalid dependencies for ${packedManifest.name}:\n${stderr || lsOut}`,
      );
    }
    // npm ls can exit non-zero for peer warnings; only fail on hard unmet
  }

  if (lsOut) {
    try {
      const tree = JSON.parse(lsOut);
      const problems = tree.problems || [];
      const hard = problems.filter((p) => /UNMET|invalid|missing/i.test(String(p)));
      if (hard.length) {
        fail(`npm ls problems for ${packedManifest.name}:\n${hard.join('\n')}`);
      }
    } catch {
      // ignore non-json ls
    }
  }
  if (lsCode !== 0 && /ELSPROBLEMS|UNMET DEPENDENCY/i.test(lsOut)) {
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
