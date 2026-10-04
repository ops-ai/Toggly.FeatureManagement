#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep, join } from 'node:path';
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

async function artifactNamesForRun() {
  const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_TOKEN } = process.env;
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GITHUB_TOKEN) {
    throw new Error('GitHub run metadata and token are required to identify flattened coverage');
  }
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/artifacts?per_page=100`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) throw new Error(`Could not list run artifacts (HTTP ${response.status})`);
  const result = await response.json();
  if (result.total_count > 100) throw new Error('Run has more than 100 artifacts; coverage name is ambiguous');
  return result.artifacts.filter(artifact =>
    artifact.name.startsWith('coverage-') && !artifact.expired,
  ).map(artifact => artifact.name);
}

export async function organizeCoverage({
  downloadDir = 'coverage-artifacts',
  outputDir = 'coverage',
  artifactNamesForRun: getArtifactNames = artifactNamesForRun,
} = {}) {
  const files = lcovFiles(downloadDir);
  if (files.length === 0) throw new Error('No LCOV reports were downloaded');

  const flatFiles = files.filter(file => relative(downloadDir, file) === 'lcov.info');
  if (flatFiles.length && files.length !== 1) {
    throw new Error('Flattened and named coverage artifacts cannot be combined');
  }
  const flatNames = flatFiles.length ? await getArtifactNames() : [];
  if (flatFiles.length && flatNames.length !== 1) {
    throw new Error('Flattened LCOV requires exactly one coverage artifact name');
  }

  const reports = new Map();
  for (const file of files) {
    const parts = relative(downloadDir, file).split(sep);
    const artifactName = flatFiles.length ? flatNames[0] : parts[0];
    const sdkName = artifactName.startsWith('coverage-') ? artifactName.slice('coverage-'.length) : '';
    if (!Object.hasOwn(SDK_PATHS, sdkName)) throw new Error(`Unknown coverage artifact: ${artifactName}`);
    const prefix = SDK_PATHS[sdkName];
    if (reports.has(sdkName)) throw new Error(`Duplicate LCOV report for ${sdkName}`);

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
