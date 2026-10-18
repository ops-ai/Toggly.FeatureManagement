/**
 * Single source of truth for aggregate JS coverage artifact names and repo paths.
 * Required SDK keys are every entry here — the organizer fails closed when any are missing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @type {Record<string, string>} */
export const SDK_PATHS = {
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

/** Sorted keys that must each have a non-empty LCOV report in aggregate CI. */
export function listRequiredCoverageSdks() {
  return Object.keys(SDK_PATHS).sort((a, b) => a.localeCompare(b));
}

export function resolveRepositoryPath(relativePath) {
  return path.join(repositoryRoot, relativePath);
}

export function assertSdkPathsExistOnDisk() {
  const missing = [];
  for (const [sdk, relativePath] of Object.entries(SDK_PATHS)) {
    if (!fs.existsSync(resolveRepositoryPath(relativePath))) {
      missing.push(`${sdk} -> ${relativePath}`);
    }
  }
  if (missing.length) {
    throw new Error(`SDK_PATHS points at missing paths:\n${missing.join('\n')}`);
  }
}
