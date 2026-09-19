#!/usr/bin/env node
/**
 * Filter JavaScript/TypeScript analysis matrix and required jobs for
 * workflow_call from release workflows (OPS-1243).
 *
 * Usage: node analysis-js-filter.mjs [sdks]
 *   sdks = "all" or comma-separated matrix SDK names (e.g. Vue,SolidJS)
 *
 * Writes GitHub Actions outputs when GITHUB_OUTPUT is set; otherwise prints JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_TEST_MATRIX = [
  {
    sdk: 'Client-Telemetry',
    path: 'toggly-client-telemetry',
    'test-cmd': 'npm run test:coverage && npm run test:packed',
    'has-lint': false,
  },
  {
    sdk: 'NestJS',
    path: 'Toggly.FeatureManagement.NestJS',
    'test-cmd': 'npm run test:coverage && npm run test:packed',
    'has-lint': false,
  },
  {
    sdk: 'Angular',
    path: 'Toggly.FeatureManagement.Angular',
    'test-cmd':
      "npm test -- ngx-feature-flags-toggly --watch=false --browsers=ChromeHeadless --code-coverage --exclude='**/smoke*.spec.ts'",
    'has-lint': false,
  },
  {
    sdk: 'React',
    path: 'Toggly.FeatureManagement.React',
    'test-cmd': 'npm test',
    'has-lint': false,
  },
  {
    sdk: 'Vue',
    path: 'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly',
    'test-cmd': 'npm test -- --coverage && npm run test:host',
    'has-lint': false,
  },
  {
    sdk: 'SolidJS',
    path: 'Toggly.FeatureManagement.Solid',
    'test-cmd': 'npm run test:coverage',
    'has-lint': false,
  },
  {
    sdk: 'Svelte',
    path: 'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly',
    'test-cmd': 'npx vitest run --coverage && npm run test:host',
    'has-lint': false,
  },
  {
    sdk: 'SvelteKit',
    path: 'Toggly.FeatureManagement.SvelteKit',
    'test-cmd': 'npm run test:coverage',
    'has-lint': false,
  },
  {
    sdk: 'Astro',
    path: 'Toggly.FeatureManagement.Astro',
    'test-cmd': 'npm test -- --coverage',
    'has-lint': false,
  },
  {
    sdk: 'Gatsby',
    path: 'Toggly.FeatureManagement.Gatsby',
    'test-cmd': 'npm run test:coverage && node tests/packed-host.mjs',
    'node-version': '24.x',
    'has-lint': false,
  },
  {
    sdk: 'JavaScript',
    path: 'Toggly.FeatureManagement.Javascript/feature_flags_toggly',
    'test-cmd': 'npm test -- --coverage',
    'has-lint': false,
  },
  {
    sdk: 'Docusaurus',
    path: 'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin',
    'test-cmd': 'npm test',
    'has-lint': false,
  },
  {
    sdk: 'Hooks-Types',
    path: 'toggly-hooks-types',
    'test-cmd': 'npm test -- --coverage',
    'has-lint': false,
  },
  {
    sdk: 'Clarity-Hook',
    path: 'toggly-clarity-hook',
    'test-cmd': 'npm test -- --coverage',
    'has-lint': false,
  },
  {
    sdk: 'GA4-Hook',
    path: 'toggly-ga4-hook',
    'test-cmd': 'npm test -- --coverage',
    'has-lint': false,
  },
  {
    sdk: 'AppInsights-Hook',
    path: 'toggly-appinsights-hook',
    'test-cmd': 'npm test -- --coverage',
    'has-lint': false,
  },
];

/** Extra required jobs beyond the matrix `test` job, keyed by matrix SDK name. */
const EXTRA_JOBS_BY_SDK = {
  Vue: ['test-current-browser-hosts'],
  Svelte: ['test-current-browser-hosts'],
  SvelteKit: ['test-current-browser-hosts'],
  SolidJS: ['solidstart-host'],
  Astro: ['test-astro-hosts'],
  Docusaurus: ['test-docusaurus-host'],
};

const SPECIAL_FILTERS = {
  'node-server': {
    jobs: ['test-node-server', 'smoke-test-node-server'],
    needSharedDeps: true,
  },
  'shared-deps': {
    jobs: ['build-shared-js-deps'],
    needSharedDeps: true,
  },
};

const ALL_REQUIRED_DEFAULT = [
  'test',
  'test-node-server',
  'smoke-test',
  'smoke-test-node-server',
  'solidstart-host',
  'test-current-browser-hosts',
  'test-docusaurus-host',
  'test-astro-hosts',
  'dependency-check',
];

const BROWSER_HOSTS = [
  {
    sdk: 'Vue',
    path: 'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly',
    browser: false,
  },
  {
    sdk: 'Svelte',
    path: 'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly',
    browser: false,
  },
  {
    sdk: 'SvelteKit',
    path: 'Toggly.FeatureManagement.SvelteKit',
    browser: true,
  },
];

function browserHostMatrix(sdkNamesOrAll) {
  const hosts =
    sdkNamesOrAll === 'all'
      ? BROWSER_HOSTS
      : BROWSER_HOSTS.filter((h) => sdkNamesOrAll.includes(h.sdk));
  const include = [];
  for (const nodeVersion of ['22.x', '24.x', '26.x']) {
    for (const host of hosts) {
      include.push({ 'node-version': nodeVersion, host });
    }
  }
  return { include };
}

export function filterAnalysisJs(sdksInput = 'all') {
  const raw = String(sdksInput || 'all').trim();
  if (!raw || raw === 'all') {
    return {
      filter: 'all',
      testMatrix: FULL_TEST_MATRIX,
      browserHostMatrix: browserHostMatrix('all'),
      needSharedDeps: true,
      runTest: true,
      runTestNodeServer: true,
      runSmokeTest: true,
      runSmokeTestNodeServer: true,
      runSolidstartHost: true,
      runTestCurrentBrowserHosts: true,
      runTestDocusaurusHost: true,
      runTestAstroHosts: true,
      requiredJobs: ALL_REQUIRED_DEFAULT.join(','),
    };
  }

  const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const specials = tokens.filter((t) => SPECIAL_FILTERS[t]);
  const sdkNames = tokens.filter((t) => !SPECIAL_FILTERS[t]);

  const testMatrix = FULL_TEST_MATRIX.filter((row) => sdkNames.includes(row.sdk));
  const unknown = sdkNames.filter((name) => !FULL_TEST_MATRIX.some((row) => row.sdk === name));
  if (unknown.length) {
    throw new Error(`Unknown analysis SDK filter(s): ${unknown.join(', ')}`);
  }

  const jobSet = new Set();
  // OWASP Dependency Check always runs (it is not gated by the sdks filter),
  // scanning the whole JS/TS dependency tree, so it must always be required.
  jobSet.add('dependency-check');
  if (testMatrix.length) {
    jobSet.add('test');
  }
  for (const name of sdkNames) {
    for (const job of EXTRA_JOBS_BY_SDK[name] || []) {
      jobSet.add(job);
    }
  }
  let needSharedDeps = testMatrix.some(
    (row) => !['SolidJS', 'SvelteKit', 'Gatsby', 'Client-Telemetry'].includes(row.sdk),
  );
  for (const special of specials) {
    const cfg = SPECIAL_FILTERS[special];
    for (const job of cfg.jobs) {
      jobSet.add(job);
    }
    if (cfg.needSharedDeps) {
      needSharedDeps = true;
    }
  }

  const requiredJobs = [...jobSet].filter((j) => j !== 'build-shared-js-deps');
  const browserHosts = BROWSER_HOSTS.filter((h) => sdkNames.includes(h.sdk));

  return {
    filter: tokens.join(','),
    testMatrix,
    browserHostMatrix: browserHostMatrix(sdkNames),
    needSharedDeps,
    runTest: jobSet.has('test'),
    runTestNodeServer: jobSet.has('test-node-server'),
    runSmokeTest: jobSet.has('smoke-test'),
    runSmokeTestNodeServer: jobSet.has('smoke-test-node-server'),
    runSolidstartHost: jobSet.has('solidstart-host'),
    runTestCurrentBrowserHosts:
      jobSet.has('test-current-browser-hosts') && browserHosts.length > 0,
    runTestDocusaurusHost: jobSet.has('test-docusaurus-host'),
    runTestAstroHosts: jobSet.has('test-astro-hosts'),
    requiredJobs: requiredJobs.join(','),
  };
}

function main() {
  const sdks = process.argv[2] || 'all';
  const result = filterAnalysisJs(sdks);
  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `filter=${result.filter}`,
      `need_shared_deps=${result.needSharedDeps}`,
      `run_test=${result.runTest}`,
      `run_test_node_server=${result.runTestNodeServer}`,
      `run_smoke_test=${result.runSmokeTest}`,
      `run_smoke_test_node_server=${result.runSmokeTestNodeServer}`,
      `run_solidstart_host=${result.runSolidstartHost}`,
      `run_test_current_browser_hosts=${result.runTestCurrentBrowserHosts}`,
      `run_test_docusaurus_host=${result.runTestDocusaurusHost}`,
      `run_test_astro_hosts=${result.runTestAstroHosts}`,
      `required_jobs=${result.requiredJobs}`,
    ];
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `test_matrix<<EOF\n${JSON.stringify({ include: result.testMatrix })}\nEOF\n`,
    );
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `browser_host_matrix<<EOF\n${JSON.stringify(result.browserHostMatrix)}\nEOF\n`,
    );
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
