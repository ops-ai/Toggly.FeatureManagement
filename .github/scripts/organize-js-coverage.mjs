#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDK_PATHS, listRequiredCoverageSdks } from './js-coverage-manifest.mjs';

export { SDK_PATHS } from './js-coverage-manifest.mjs';

/** Every manifest SDK must contribute LCOV in aggregate CI (no optional gaps). */
export const REQUIRED_COVERAGE_SDKS = listRequiredCoverageSdks();

function lcovFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return lcovFiles(path);
    return entry.isFile() && entry.name === 'lcov.info' ? [path] : [];
  });
}

function preferredLcov(directory) {
  const direct = join(directory, 'lcov.info');
  if (existsSync(direct)) return direct;
  const files = lcovFiles(directory);
  if (files.length > 1) {
    throw new Error(`Multiple LCOV reports in ${directory}`);
  }
  return files[0] ?? null;
}

function containsArtifactContainer(directory) {
  if (basename(directory).startsWith('coverage-') || existsSync(join(directory, 'artifact-name.txt'))) {
    return true;
  }
  return readdirSync(directory, { withFileTypes: true }).some(entry =>
    entry.isDirectory() && containsArtifactContainer(join(directory, entry.name)),
  );
}

function requireFullCoverage() {
  const raw = String(process.env.REQUIRE_FULL_JS_COVERAGE ?? 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export async function organizeCoverage({
  downloadDir = 'coverage-artifacts',
  outputDir = 'coverage',
  requireFull = requireFullCoverage(),
} = {}) {
  const files = lcovFiles(downloadDir);
  if (files.length === 0) throw new Error('No LCOV reports were downloaded');

  const flatFile = files.find(file => relative(downloadDir, file) === 'lcov.info');
  const namedDirs = readdirSync(downloadDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(downloadDir, entry.name));
  // A flattened artifact can include HTML and nested coverage report payloads.
  // Artifact names or bundled markers identify genuinely mixed downloads.
  if (flatFile && namedDirs.some(containsArtifactContainer)) {
    throw new Error('Flattened and named coverage artifacts cannot be combined');
  }
  const artifactDirs = flatFile ? [downloadDir] : namedDirs;

  const reports = new Map();
  for (const directory of artifactDirs) {
    const marker = join(directory, 'artifact-name.txt');
    const fallbackName = relative(downloadDir, directory);
    if (flatFile && !existsSync(marker)) throw new Error(`Missing artifact name in ${directory}`);
    const artifactName = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : fallbackName;
    if (!flatFile && artifactName !== fallbackName) {
      throw new Error(`Artifact name ${artifactName} does not match ${fallbackName}`);
    }
    const sdkName = artifactName.startsWith('coverage-') ? artifactName.slice('coverage-'.length) : '';
    if (!Object.hasOwn(SDK_PATHS, sdkName)) throw new Error(`Unknown coverage artifact: ${artifactName}`);
    const prefix = SDK_PATHS[sdkName];
    if (reports.has(sdkName)) throw new Error(`Duplicate LCOV report for ${sdkName}`);

    const file = preferredLcov(directory);
    if (!file) throw new Error(`Missing LCOV report for ${artifactName}`);
    const content = readFileSync(file, 'utf8');
    if (!content.split('\n').some(line => line.startsWith('SF:') && line.slice(3).trim())) {
      throw new Error(`LCOV report for ${sdkName} has no source files`);
    }
    reports.set(sdkName, content.replace(/^SF:/gm, `SF:${prefix}/`));
  }

  if (reports.size === 0) throw new Error('No LCOV reports were downloaded');

  if (requireFull) {
    const missing = REQUIRED_COVERAGE_SDKS.filter((sdk) => !reports.has(sdk));
    if (missing.length) {
      throw new Error(
        `Incomplete coverage bundle for aggregate Sonar scan (missing ${missing.length}): ${missing.join(', ')}`,
      );
    }
  }

  mkdirSync(outputDir, { recursive: true });
  for (const [sdkName, content] of reports) {
    writeFileSync(join(outputDir, `${sdkName}-lcov.info`), content);
    console.log(`Mapped coverage-${sdkName} to ${SDK_PATHS[sdkName]}`);
  }

  const lineHits = [...reports.values()].join('').match(/^DA:\d+,\d+/gm)?.length ?? 0;
  console.log(
    `Aggregate coverage bundle: ${reports.size} mapped LCOV report(s); REQUIRED_COVERAGE_SDKS=${REQUIRED_COVERAGE_SDKS.length}`,
  );
  if (lineHits) {
    console.log(`LCOV line entries (DA records) across bundle: ${lineHits}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  organizeCoverage().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
