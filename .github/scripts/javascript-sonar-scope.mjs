#!/usr/bin/env node
/**
 * Resolve SonarCloud/Server scope for analysis-javascript.yml.
 * Full PR analysis uses the aggregate toggly-sdks-javascript project.
 * Narrowed release gates use per-SDK project keys and scoped sources/coverage
 * so concurrent develop publishes do not overwrite branch analyses (OPS-1900).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGGREGATE_PROJECT_KEY = 'toggly-sdks-javascript';
const AGGREGATE_PROJECT_NAME = 'Toggly SDKs - JavaScript/TypeScript';

const AGGREGATE_SOURCES = [
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

const AGGREGATE_OWASP_PATHS = [
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

const AGGREGATE_NPM_INSTALL_DIRS = [
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

/** @type {Record<string, { slug: string, label: string, sources: string[], tests: string[], coverageKeys: string[], manifest: string, owaspPaths: string[], npmInstallDirs: string[] }>} */
export const SDK_SCOPES = {
  'Client-Telemetry': {
    slug: 'client-telemetry',
    label: 'Client Telemetry',
    sources: ['toggly-client-telemetry'],
    tests: ['toggly-client-telemetry'],
    coverageKeys: ['Client-Telemetry'],
    manifest: 'toggly-client-telemetry/package.json',
    owaspPaths: ['toggly-client-telemetry'],
    npmInstallDirs: ['toggly-client-telemetry'],
  },
  'Client-Core': {
    slug: 'client-core',
    label: 'Client Core',
    sources: ['toggly-docusaurus-edge-sdk/libs/core'],
    tests: ['toggly-docusaurus-edge-sdk/libs/core'],
    coverageKeys: ['Client-Core'],
    manifest: 'toggly-docusaurus-edge-sdk/libs/core/package.json',
    owaspPaths: ['toggly-docusaurus-edge-sdk/libs/core'],
    npmInstallDirs: ['toggly-docusaurus-edge-sdk/libs/core'],
  },
  Evaluator: {
    slug: 'evaluator',
    label: 'Evaluator',
    sources: ['toggly-eval'],
    tests: ['toggly-eval'],
    coverageKeys: ['Evaluator'],
    manifest: 'toggly-eval/package.json',
    owaspPaths: ['toggly-eval'],
    npmInstallDirs: ['toggly-eval'],
  },
  'Local-Gates': {
    slug: 'local-gates',
    label: 'Local Gates',
    sources: ['toggly-local-gates/src'],
    tests: ['toggly-local-gates'],
    coverageKeys: ['Local-Gates'],
    manifest: 'toggly-local-gates/package.json',
    owaspPaths: ['toggly-local-gates'],
    npmInstallDirs: ['toggly-local-gates'],
  },
  NestJS: {
    slug: 'nestjs',
    label: 'NestJS',
    sources: ['Toggly.FeatureManagement.NestJS'],
    tests: ['Toggly.FeatureManagement.NestJS'],
    coverageKeys: ['NestJS'],
    manifest: 'Toggly.FeatureManagement.NestJS/package.json',
    owaspPaths: ['Toggly.FeatureManagement.NestJS'],
    npmInstallDirs: ['Toggly.FeatureManagement.NestJS'],
  },
  Angular: {
    slug: 'angular',
    label: 'Angular',
    sources: ['Toggly.FeatureManagement.Angular'],
    tests: ['Toggly.FeatureManagement.Angular'],
    coverageKeys: ['Angular'],
    manifest: 'Toggly.FeatureManagement.Angular/projects/ngx-feature-flags-toggly/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Angular/projects/ngx-feature-flags-toggly'],
    npmInstallDirs: ['Toggly.FeatureManagement.Angular'],
  },
  React: {
    slug: 'react',
    label: 'React',
    sources: ['Toggly.FeatureManagement.React'],
    tests: ['Toggly.FeatureManagement.React', 'tests'],
    coverageKeys: ['React'],
    manifest: 'Toggly.FeatureManagement.React/package.json',
    owaspPaths: ['Toggly.FeatureManagement.React'],
    npmInstallDirs: ['Toggly.FeatureManagement.React'],
  },
  Vue: {
    slug: 'vue',
    label: 'Vue',
    sources: ['Toggly.FeatureManagement.Vue/vue-feature-flags-toggly'],
    tests: ['Toggly.FeatureManagement.Vue/vue-feature-flags-toggly'],
    coverageKeys: ['Vue'],
    manifest: 'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Vue'],
    npmInstallDirs: [
      'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly',
      'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/example',
    ],
  },
  SolidJS: {
    slug: 'solidjs',
    label: 'SolidJS',
    sources: ['Toggly.FeatureManagement.Solid'],
    tests: ['Toggly.FeatureManagement.Solid'],
    coverageKeys: ['SolidJS'],
    manifest: 'Toggly.FeatureManagement.Solid/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Solid'],
    npmInstallDirs: ['Toggly.FeatureManagement.Solid'],
  },
  Svelte: {
    slug: 'svelte',
    label: 'Svelte',
    sources: ['Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly'],
    tests: ['Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly'],
    coverageKeys: ['Svelte'],
    manifest: 'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Svelte'],
    npmInstallDirs: ['Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly'],
  },
  SvelteKit: {
    slug: 'sveltekit',
    label: 'SvelteKit',
    sources: ['Toggly.FeatureManagement.SvelteKit'],
    tests: ['Toggly.FeatureManagement.SvelteKit'],
    coverageKeys: ['SvelteKit'],
    manifest: 'Toggly.FeatureManagement.SvelteKit/package.json',
    owaspPaths: ['Toggly.FeatureManagement.SvelteKit'],
    npmInstallDirs: ['Toggly.FeatureManagement.SvelteKit'],
  },
  Astro: {
    slug: 'astro',
    label: 'Astro',
    sources: ['Toggly.FeatureManagement.Astro'],
    tests: ['Toggly.FeatureManagement.Astro'],
    coverageKeys: ['Astro'],
    manifest: 'Toggly.FeatureManagement.Astro/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Astro'],
    npmInstallDirs: ['Toggly.FeatureManagement.Astro'],
  },
  Gatsby: {
    slug: 'gatsby',
    label: 'Gatsby',
    sources: ['Toggly.FeatureManagement.Gatsby'],
    tests: ['Toggly.FeatureManagement.Gatsby'],
    coverageKeys: ['Gatsby'],
    manifest: 'Toggly.FeatureManagement.Gatsby/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Gatsby'],
    npmInstallDirs: ['Toggly.FeatureManagement.Gatsby'],
  },
  JavaScript: {
    slug: 'javascript',
    label: 'JavaScript',
    sources: ['Toggly.FeatureManagement.Javascript/feature_flags_toggly'],
    tests: ['Toggly.FeatureManagement.Javascript/feature_flags_toggly'],
    coverageKeys: ['JavaScript'],
    manifest: 'Toggly.FeatureManagement.Javascript/feature_flags_toggly/package.json',
    owaspPaths: ['Toggly.FeatureManagement.Javascript'],
    npmInstallDirs: ['Toggly.FeatureManagement.Javascript/feature_flags_toggly'],
  },
  Docusaurus: {
    slug: 'docusaurus',
    label: 'Docusaurus',
    sources: [
      'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin',
      'toggly-docusaurus-edge-sdk/cloudflare/pages-function',
    ],
    tests: [
      'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin',
      'toggly-docusaurus-edge-sdk/cloudflare/pages-function',
      'tests',
    ],
    coverageKeys: ['Docusaurus', 'Docusaurus-Pages'],
    manifest: 'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin/package.json',
    owaspPaths: ['toggly-docusaurus-edge-sdk'],
    npmInstallDirs: [
      'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin',
      'toggly-docusaurus-edge-sdk/cloudflare/pages-function',
    ],
  },
  'Hooks-Types': {
    slug: 'hooks-types',
    label: 'Hooks Types',
    sources: ['toggly-hooks-types'],
    tests: ['toggly-hooks-types'],
    coverageKeys: ['Hooks-Types'],
    manifest: 'toggly-hooks-types/package.json',
    owaspPaths: ['toggly-hooks-types'],
    npmInstallDirs: ['toggly-hooks-types'],
  },
  'Clarity-Hook': {
    slug: 'clarity-hook',
    label: 'Clarity Hook',
    sources: ['toggly-clarity-hook'],
    tests: ['toggly-clarity-hook'],
    coverageKeys: ['Clarity-Hook'],
    manifest: 'toggly-clarity-hook/package.json',
    owaspPaths: ['toggly-clarity-hook'],
    npmInstallDirs: ['toggly-clarity-hook'],
  },
  'GA4-Hook': {
    slug: 'ga4-hook',
    label: 'GA4 Hook',
    sources: ['toggly-ga4-hook'],
    tests: ['toggly-ga4-hook'],
    coverageKeys: ['GA4-Hook'],
    manifest: 'toggly-ga4-hook/package.json',
    owaspPaths: ['toggly-ga4-hook'],
    npmInstallDirs: ['toggly-ga4-hook'],
  },
  'AppInsights-Hook': {
    slug: 'appinsights-hook',
    label: 'Application Insights Hook',
    sources: ['toggly-appinsights-hook'],
    tests: ['toggly-appinsights-hook'],
    coverageKeys: ['AppInsights-Hook'],
    manifest: 'toggly-appinsights-hook/package.json',
    owaspPaths: ['toggly-appinsights-hook'],
    npmInstallDirs: ['toggly-appinsights-hook'],
  },
};

const NODE_SERVER_SCOPE = {
  slug: 'node-server',
  label: 'Node.js Server',
  sources: ['Toggly.FeatureManagement.Node'],
  tests: ['Toggly.FeatureManagement.Node', 'tests'],
  coverageKeys: ['Node-Core', 'Node-Express', 'Node-Fastify', 'Node-Hono', 'Node-Koa'],
  manifest: 'Toggly.FeatureManagement.Node/toggly-node-core/package.json',
  owaspPaths: ['Toggly.FeatureManagement.Node'],
  npmInstallDirs: ['Toggly.FeatureManagement.Node'],
};

function unique(values) {
  return [...new Set(values)];
}

function joinCsv(values) {
  return unique(values).join(',');
}

function mergeScopes(scopes) {
  return {
    sources: unique(scopes.flatMap((scope) => scope.sources)),
    tests: unique(scopes.flatMap((scope) => scope.tests)),
    coverageKeys: unique(scopes.flatMap((scope) => scope.coverageKeys)),
    manifest: scopes[0].manifest,
    owaspPaths: unique(scopes.flatMap((scope) => scope.owaspPaths)),
    npmInstallDirs: unique(scopes.flatMap((scope) => scope.npmInstallDirs)),
    slug: scopes.map((scope) => scope.slug).sort().join('-'),
    label: scopes.map((scope) => scope.label).join(' + '),
  };
}

export function resolveJavaScriptSonarScope(sdksInput = 'all') {
  const raw = String(sdksInput || 'all').trim();
  if (!raw || raw === 'all') {
    return {
      scoped: false,
      projectKey: AGGREGATE_PROJECT_KEY,
      projectName: AGGREGATE_PROJECT_NAME,
      sources: joinCsv(AGGREGATE_SOURCES),
      tests: joinCsv([...AGGREGATE_SOURCES, 'tests']),
      manifest: 'Toggly.FeatureManagement.Javascript/feature_flags_toggly/package.json',
      coverageKeys: '',
      owaspPaths: AGGREGATE_OWASP_PATHS.join('\n'),
      npmInstallDirs: AGGREGATE_NPM_INSTALL_DIRS,
    };
  }

  const tokens = raw.split(',').map((token) => token.trim()).filter(Boolean);
  const specials = tokens.filter((token) => token === 'node-server' || token === 'shared-deps');
  const sdkNames = tokens.filter((token) => token !== 'node-server' && token !== 'shared-deps');

  const scopes = [];
  if (specials.includes('node-server')) {
    scopes.push(NODE_SERVER_SCOPE);
  }
  for (const name of sdkNames) {
    const scope = SDK_SCOPES[name];
    if (!scope) {
      throw new Error(`Unknown Sonar scope SDK: ${name}`);
    }
    scopes.push(scope);
  }
  if (scopes.length === 0) {
    throw new Error(`No Sonar scope resolved for filter: ${raw}`);
  }

  const merged = mergeScopes(scopes);
  const projectKey = `${AGGREGATE_PROJECT_KEY}-${merged.slug}`;

  return {
    scoped: true,
    projectKey,
    projectName: `Toggly SDKs - JavaScript ${merged.label}`,
    sources: joinCsv(merged.sources),
    tests: joinCsv(merged.tests),
    manifest: merged.manifest,
    coverageKeys: joinCsv(merged.coverageKeys),
    owaspPaths: merged.owaspPaths.join('\n'),
    npmInstallDirs: merged.npmInstallDirs,
  };
}

function writeGithubOutput(result) {
  const lines = [
    `sonar_scoped=${result.scoped}`,
    `sonar_project_key=${result.projectKey}`,
    `sonar_project_name=${result.projectName}`,
    `sonar_sources=${result.sources}`,
    `sonar_tests=${result.tests}`,
    `sonar_manifest=${result.manifest}`,
    `coverage_sdk_keys=${result.coverageKeys}`,
    `owasp_scan_paths<<EOF\n${result.owaspPaths}\nEOF`,
    `sonar_npm_install_dirs<<EOF\n${result.npmInstallDirs.join('\n')}\nEOF`,
  ];
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

function main() {
  const sdks = process.argv[2] || 'all';
  const result = resolveJavaScriptSonarScope(sdks);
  if (process.env.GITHUB_OUTPUT) {
    writeGithubOutput(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
