#!/usr/bin/env node
/**
 * Single Sonar project (toggly-sdks-javascript) configuration for JS/TS analysis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGGREGATE_PROJECT_KEY = 'toggly-sdks-javascript';
export const AGGREGATE_PROJECT_NAME = 'Toggly SDKs - JavaScript/TypeScript';

export const AGGREGATE_SOURCES = [
  'Toggly.FeatureManagement.Angular',
  'Toggly.FeatureManagement.React',
  'Toggly.FeatureManagement.Vue',
  'Toggly.FeatureManagement.Svelte',
  'Toggly.FeatureManagement.SvelteKit',
  'Toggly.FeatureManagement.Solid',
  'Toggly.FeatureManagement.Astro',
  'Toggly.FeatureManagement.Gatsby',
  'toggly-docusaurus-edge-sdk',
  'Toggly.FeatureManagement.Javascript',
  'Toggly.FeatureManagement.Node',
  'Toggly.FeatureManagement.NestJS',
  'toggly-eval',
  'toggly-local-gates/src',
  'toggly-hooks-types',
  'toggly-signed-defs/src',
  'toggly-clarity-hook',
  'toggly-ga4-hook',
  'toggly-appinsights-hook',
  'toggly-client-telemetry',
];

export const AGGREGATE_OWASP_PATHS = [
  'Toggly.FeatureManagement.Angular/projects/ngx-feature-flags-toggly',
  'Toggly.FeatureManagement.React',
  'Toggly.FeatureManagement.Vue',
  'Toggly.FeatureManagement.Svelte',
  'Toggly.FeatureManagement.SvelteKit',
  'Toggly.FeatureManagement.Solid',
  'Toggly.FeatureManagement.Astro',
  'Toggly.FeatureManagement.Javascript',
  'Toggly.FeatureManagement.Node',
  'Toggly.FeatureManagement.NestJS',
  'toggly-docusaurus-edge-sdk',
  'toggly-client-telemetry',
  'toggly-hooks-types',
  'toggly-clarity-hook',
  'toggly-ga4-hook',
  'toggly-appinsights-hook',
];

export const AGGREGATE_NPM_INSTALL_DIRS = [
  'Toggly.FeatureManagement.Solid',
  'Toggly.FeatureManagement.Angular',
  'Toggly.FeatureManagement.React',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/example',
  'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly',
  'Toggly.FeatureManagement.SvelteKit',
  'Toggly.FeatureManagement.Astro',
  'Toggly.FeatureManagement.NestJS',
  'Toggly.FeatureManagement.Javascript/feature_flags_toggly',
  'toggly-eval',
  'toggly-client-telemetry',
  'toggly-hooks-types',
  'toggly-clarity-hook',
  'toggly-ga4-hook',
  'toggly-appinsights-hook',
];

export function aggregateSonarConfig() {
  const sources = AGGREGATE_SOURCES.join(',');
  const tests = [...AGGREGATE_SOURCES, 'tests'].join(',');
  return {
    projectKey: AGGREGATE_PROJECT_KEY,
    projectName: AGGREGATE_PROJECT_NAME,
    sources,
    tests,
    manifest: 'Toggly.FeatureManagement.Javascript/feature_flags_toggly/package.json',
    owaspPaths: AGGREGATE_OWASP_PATHS.join('\n'),
    npmInstallDirs: AGGREGATE_NPM_INSTALL_DIRS.join('\n'),
  };
}

function main() {
  const config = aggregateSonarConfig();
  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `sonar_project_key=${config.projectKey}`,
      `sonar_project_name=${config.projectName}`,
      `sonar_sources=${config.sources}`,
      `sonar_tests=${config.tests}`,
      `sonar_manifest=${config.manifest}`,
      `owasp_scan_paths<<EOF\n${config.owaspPaths}\nEOF`,
      `sonar_npm_install_dirs<<EOF\n${config.npmInstallDirs}\nEOF`,
    ];
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  } else {
    console.log(JSON.stringify(config, null, 2));
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
