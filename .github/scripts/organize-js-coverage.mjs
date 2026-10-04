#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_PATHS = {
  Angular: 'Toggly.FeatureManagement.Angular',
  React: 'Toggly.FeatureManagement.React',
  Vue: 'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly',
  SolidJS: 'Toggly.FeatureManagement.Solid',
  Svelte: 'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly',
  SvelteKit: 'Toggly.FeatureManagement.SvelteKit',
  Astro: 'Toggly.FeatureManagement.Astro',
  Gatsby: 'Toggly.FeatureManagement.Gatsby',
  JavaScript: 'Toggly.FeatureManagement.Javascript/feature_flags_toggly',
  Docusaurus: 'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin',
  'Docusaurus-Pages': 'toggly-docusaurus-edge-sdk/cloudflare/pages-function',
  'Client-Core': 'toggly-docusaurus-edge-sdk/libs/core',
  'Clarity-Hook': 'toggly-clarity-hook',
  'GA4-Hook': 'toggly-ga4-hook',
  'AppInsights-Hook': 'toggly-appinsights-hook',
  'Hooks-Types': 'toggly-hooks-types',
  'Signed-Defs': 'toggly-signed-defs',
  'Client-Telemetry': 'toggly-client-telemetry',
  Evaluator: 'toggly-eval',
  'Local-Gates': 'toggly-local-gates',
  NestJS: 'Toggly.FeatureManagement.NestJS',
  'Node-Core': 'Toggly.FeatureManagement.Node/toggly-node-core',
  'Node-Express': 'Toggly.FeatureManagement.Node/toggly-express',
  'Node-Fastify': 'Toggly.FeatureManagement.Node/toggly-fastify',
  'Node-Hono': 'Toggly.FeatureManagement.Node/toggly-hono',
  'Node-Koa': 'Toggly.FeatureManagement.Node/toggly-koa',
};

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

export async function organizeCoverage({
  downloadDir = 'coverage-artifacts',
  outputDir = 'coverage',
} = {}) {
  const files = lcovFiles(downloadDir);
  if (files.length === 0) throw new Error('No LCOV reports were downloaded');

  const flatFile = files.find(file => relative(downloadDir, file) === 'lcov.info');
  const namedDirs = readdirSync(downloadDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(downloadDir, entry.name));
  if (flatFile && namedDirs.length > 0) {
    throw new Error('Flattened and named coverage artifacts cannot be combined');
  }
  const artifactDirs = flatFile ? [downloadDir] : namedDirs;

  const reports = new Map();
  for (const directory of artifactDirs) {
    const marker = join(directory, 'artifact-name.txt');
    if (!existsSync(marker)) throw new Error(`Missing artifact name in ${directory}`);
    const artifactName = readFileSync(marker, 'utf8').trim();
    if (!flatFile && artifactName !== relative(downloadDir, directory)) {
      throw new Error(`Artifact name ${artifactName} does not match ${relative(downloadDir, directory)}`);
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

  mkdirSync(outputDir, { recursive: true });
  for (const [sdkName, content] of reports) {
    writeFileSync(join(outputDir, `${sdkName}-lcov.info`), content);
    console.log(`Mapped coverage-${sdkName} to ${SDK_PATHS[sdkName]}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  organizeCoverage().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
