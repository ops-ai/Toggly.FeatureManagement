#!/usr/bin/env node
/**
 * Resolve sonar.projectVersion from an SDK manifest.
 *
 * Suffix: empty/unset → +baseline (one-time leak cutover).
 * Set SONAR_PROJECT_VERSION_SUFFIX to none / - / off to send the plain package version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectManifestType, readManifestVersion } from './read-manifest-version.mjs';

export function applySonarVersionSuffix(version, suffixEnv) {
  const raw = suffixEnv === undefined || suffixEnv === '' ? '+baseline' : String(suffixEnv).trim();
  if (raw === 'none' || raw === '-' || raw === 'off') {
    return version;
  }
  const suffix = raw.startsWith('+') || raw.startsWith('-') ? raw : `+${raw}`;
  return `${version}${suffix}`;
}

export function resolveSonarProjectVersion({
  manifestPath,
  manifestType = '',
  suffixEnv,
  cwd = process.cwd(),
}) {
  const resolved = path.resolve(cwd, manifestPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Manifest not found: ${resolved}`);
  }
  const type = detectManifestType(resolved, manifestType);
  const packageVersion = String(readManifestVersion(resolved, type)).trim();
  if (!packageVersion) {
    throw new Error(`Empty version in ${resolved}`);
  }
  return {
    packageVersion,
    version: applySonarVersionSuffix(packageVersion, suffixEnv),
  };
}

function parseArgs(argv) {
  const args = { manifest: '', type: '', suffix: process.env.SONAR_PROJECT_VERSION_SUFFIX };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest') {
      args.manifest = argv[++i] ?? '';
    } else if (token === '--type') {
      args.type = argv[++i] ?? '';
    } else if (token === '--suffix') {
      args.suffix = argv[++i] ?? '';
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    console.error('Usage: sonar-project-version.mjs --manifest <path> [--type <kind>] [--suffix <suffix>]');
    process.exit(1);
  }
  const result = resolveSonarProjectVersion({
    manifestPath: args.manifest,
    manifestType: args.type,
    suffixEnv: args.suffix,
  });
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `package_version=${result.packageVersion}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\n`);
  }
  console.log(result.version);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
