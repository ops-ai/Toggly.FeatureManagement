import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  failedRequiredJobs,
  splitJobList,
  verifyRequiredJobs,
} from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-javascript.yml', import.meta.url), 'utf8');
const docusaurusFixture = readFileSync(
  new URL('../../tests/docusaurus-consumer-fixtures/packed-host.mjs', import.meta.url),
  'utf8',
);
const summary = workflow.slice(workflow.indexOf('\n  summary:'));
const prepare = workflow.match(/\n  prepare:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
const selections = new Map();

// Exercise the same CLI/output protocol consumed by the workflow, including
// matrix serialization; testing only the exported selector misses this boundary.
function selectAnalysis(sdks) {
  if (selections.has(sdks)) return selections.get(sdks);
  const directory = mkdtempSync(join(tmpdir(), 'toggly-analysis-filter-'));
  try {
    const output = join(directory, 'outputs');
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../package-registry/analysis-js-filter.mjs', import.meta.url)), sdks,
    ], { env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8', timeout: 10000 });
    const text = readFileSync(output, 'utf8');
    const value = name => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];
    const result = {
      requiredJobs: splitJobList(value('required_jobs')),
      runBrowserHosts: value('run_test_current_browser_hosts'),
      runDocusaurusHost: value('run_test_docusaurus_host'),
      testMatrix: JSON.parse(text.match(/^test_matrix<<EOF\n([^\n]+)\nEOF$/m)?.[1] ?? 'null'),
    };
    selections.set(sdks, result);
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertRequiredHost(sdks, job) {
  const required = selectAnalysis(sdks).requiredJobs;
  assert.ok(required.includes(job), `${sdks} must require ${job}`);
  const successful = Object.fromEntries(required.map(name => [name, { result: 'success' }]));
  verifyRequiredJobs(successful, required);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const needs = { ...successful };
    if (result === undefined) delete needs[job];
    else needs[job] = { result };
    assert.throws(() => verifyRequiredJobs(needs, required), error =>
      error.failed.length === 1 && error.failed[0] === job,
    );
  }
}

function stepBlock(scope, stepName) {
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = scope.match(new RegExp(`- name: ${escaped}\\n([\\s\\S]*?)(?=\\n\\s*- name:|\\n {0,2}\\S[^\\n]*:\\n|$)`));
  assert.ok(match, `expected to find a "${stepName}" step`);
  return match[0];
}
const packedHostHarnesses = [
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/test-host.mjs',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/browser-check.mjs',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/browser-cleanup.test.mjs',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/host-resources.mjs',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/tests/host/**',
  'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/scripts/test-host.mjs',
  'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/scripts/test-browser-host.mjs',
  'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/tests/host/**'
];

test('requires current packed browser-host validation in the analysis summary', () => {
  const needs = summary.match(/needs: \[([^\]]+)\]/)?.[1];
  assert.ok(needs, 'analysis summary must declare its required jobs');
  assert.match(needs, /\btest-current-browser-hosts\b/);
  assert.match(summary, /uses: \.\/\.github\/actions\/verify-required-jobs/);
  assert.match(summary, /needs-json: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(summary, /required-jobs: \$\{\{ needs\.prepare\.outputs\.required_jobs \}\}/);
  assert.match(prepare, /required_jobs: \$\{\{ steps\.filter\.outputs\.required_jobs \}\}/);
  assert.match(prepare, /run: node \.github\/package-registry\/analysis-js-filter\.mjs "\$SDKS"/);
  assert.match(prepare, /run_test_current_browser_hosts: \$\{\{ steps\.filter\.outputs\.run_test_current_browser_hosts \}\}/);
  assert.match(workflow, /test-current-browser-hosts:[\s\S]*?if: needs\.prepare\.outputs\.run_test_current_browser_hosts == 'true'/);
  for (const sdks of ['all', 'Vue', 'Svelte', 'SvelteKit']) {
    assertRequiredHost(sdks, 'test-current-browser-hosts');
    assert.equal(selectAnalysis(sdks).runBrowserHosts, 'true');
  }
});

test('does not count packed Vue and Svelte host harnesses as production source', () => {
  const scanExclusions = [...workflow.matchAll(/-Dsonar\.exclusions=([^\n]+)/g)].map((match) => match[1]);

  assert.equal(scanExclusions.length, 2, 'both Sonar scans must define source exclusions');
  for (const exclusions of scanExclusions) {
    for (const harness of packedHostHarnesses) assert.ok(exclusions.includes(harness));
  }
});

test('requires authenticated SonarCloud and Server quality gates', () => {
  const sonar = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const cloudCredentials = stepBlock(sonar, 'Validate SonarCloud credentials');
  const serverCredentials = stepBlock(sonar, 'Validate SonarQube Server credentials');
  const cloud = stepBlock(sonar, 'SonarCloud Scan');
  const server = stepBlock(sonar, 'SonarQube Server Scan');

  assert.match(cloudCredentials, /test -n "\$\{SONAR_TOKEN\}"/);
  assert.match(serverCredentials, /test -n "\$\{SONAR_SERVER_TOKEN\}" && test -n "\$\{SONAR_HOST_URL\}"/);
  assert.match(cloud, /SONAR_HOST_URL: https:\/\/sonarcloud\.io/);
  assert.match(cloud, /-Dsonar\.organization=ops-ai/);
  assert.match(cloud, /-Dsonar\.qualitygate\.wait=true/);
  assert.doesNotMatch(cloud, /continue-on-error/);
  assert.match(server, /SONAR_HOST_URL: \$\{\{ secrets\.SONAR_HOST_URL \}\}/);
  assert.doesNotMatch(server, /-Dsonar\.organization=ops-ai/);
  assert.match(server, /-Dsonar\.qualitygate\.wait=true/);
  assert.doesNotMatch(server, /continue-on-error/);
  assert.match(server, /if:.*success\(\) \|\| failure\(\)/);
  assert.match(server, /if:.*steps\.validate-sonarqube-server-credentials\.outcome == 'success'/);
});

test('JS Sonar ignores protocol SHA-1 kid, anonymous RNG, and Angular load complexity', () => {
  const sonar = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const step = stepBlock(sonar, name);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria=angularLoadComplexity,kidSha1,anonRng,hookAwait,/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.angularLoadComplexity\.ruleKey=typescript:S3776/);
    assert.match(
      step,
      /-Dsonar\.issue\.ignore\.multicriteria\.angularLoadComplexity\.resourceKey=\*\*\/ngx-feature-flags-toggly\/\*\*\/toggly\.service\.ts/,
    );
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.kidSha1\.ruleKey=typescript:S4790/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.kidSha1\.resourceKey=\*\*\/toggly-node-core\/\*\*\/verify\.ts/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.anonRng\.ruleKey=typescript:S2245/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.anonRng\.resourceKey=\*\*\/toggly-eval\/\*\*\/segment\.ts/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.hookAwait\.ruleKey=typescript:S9382/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.hookAwait\.resourceKey=\*\*\/hooks\.ts/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.seqAwaitClient\.ruleKey=typescript:S9382/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.sdkServiceComplexity\.ruleKey=typescript:S3776/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.sdkServiceComplexity\.resourceKey=\*\*\/toggly\.service\.ts/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.testAssertStyle\.ruleKey=typescript:S5906/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.asyncApiSurface\.ruleKey=typescript:S7503/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.styleReadonly\.ruleKey=typescript:S2933/);
    assert.match(step, /-Dsonar\.test\.exclusions=.*\*\/host-fixtures\/\*\*/);
    assert.match(step, /-Dsonar\.exclusions=.*\*\/host-fixtures\/\*\*/);
    assert.match(step, /-Dsonar\.exclusions=.*toggly-hooks-types\/reference\/\*\*/);
  }
});

test('requires Sonar and rejects fork skips while allowing reporting-disabled reusable calls', () => {
  const sonar = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const dependencyCheck = workflow.match(/\n  dependency-check:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';

  assert.match(sonar, /toJSON\(inputs\.run_reporting\) != 'false'/);
  assert.match(sonar, /github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.head\.repo\.fork/);
  assert.match(dependencyCheck, /github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.head\.repo\.fork/);
  assert.match(summary, /allow-skipped:.*toJSON\(inputs\.run_reporting\) == 'false'/);
  assert.doesNotMatch(summary, /allow-skipped:.*github\.event_name == 'pull_request'.*github\.event\.pull_request\.head\.repo\.fork/);
  assert.match(summary, /allow-skipped:.*dependency-check,sonar/);
  assert.match(summary, /allow-skipped:.*\|\| 'none'/);

  for (const sdks of ['all', 'GA4-Hook', 'node-server']) {
    assert.ok(selectAnalysis(sdks).requiredJobs.includes('sonar'), `${sdks} must require Sonar`);
  }

  assert.deepEqual(
    failedRequiredJobs({ 'dependency-check': { result: 'success' } }, ['sonar', 'dependency-check']),
    ['sonar'],
  );
  const needs = { sonar: { result: 'failure' }, 'dependency-check': { result: 'success' } };
  assert.deepEqual(failedRequiredJobs(needs, ['sonar', 'dependency-check']), ['sonar']);
  needs.sonar.result = 'skipped';
  // Fork PRs skip secret-bearing reporting jobs but cannot pass this aggregate gate.
  assert.deepEqual(failedRequiredJobs(needs, ['sonar', 'dependency-check']), ['sonar']);
  // Only a reporting-disabled reusable call supplies the explicit allow list.
  assert.deepEqual(failedRequiredJobs(needs, ['sonar', 'dependency-check'], ['sonar']), []);
});

test('uploads signed definitions coverage and includes its source in both Sonar scans', () => {
  const sharedJob = workflow.match(/\n  build-shared-js-deps:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  assert.match(sharedJob, /working-directory: toggly-signed-defs\s+run: \|\s+npm run test:coverage/);
  assert.match(sharedJob, /name: coverage-Signed-Defs/);
  assert.match(sharedJob, /path: toggly-signed-defs\/coverage\/lcov\.info/);
  assert.match(sharedJob, /if-no-files-found: error/);

  const sonarJob = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  assert.match(sonarJob, /pattern: coverage-\*/);
  assert.match(sonarJob, /\["Signed-Defs"\]="toggly-signed-defs"/);
  assert.match(sonarJob, /sed "s\|SF:\|SF:\$\{prefix\}\/\|g" "\$file" > "coverage\/\$\{sdk_name\}-lcov\.info"/);

  for (const property of ['sources', 'tests']) {
    const values = [...sonarJob.matchAll(new RegExp(`-Dsonar\\.${property}=([^\\n]+)`, 'g'))].map((match) => match[1]);
    assert.equal(values.length, 2, `both Sonar scans need ${property}`);
    for (const value of values) {
      assert.ok(value.split(',').includes('toggly-signed-defs/src'), `signed-defs source missing from ${property}`);
    }
  }
  for (const property of ['javascript.lcov.reportPaths', 'typescript.lcov.reportPaths']) {
    const values = [...sonarJob.matchAll(new RegExp(`-Dsonar\\.${property.replaceAll('.', '\\.')}=([^\\n]+)`, 'g'))].map((match) => match[1]);
    assert.deepEqual(values, ['coverage/*-lcov.info', 'coverage/*-lcov.info']);
  }
  for (const [, exclusions] of sonarJob.matchAll(/-Dsonar\.(?:coverage\.)?exclusions=([^\n]+)/g)) {
    assert.ok(!exclusions.includes('toggly-signed-defs'), 'signed definitions production code must not be excluded');
  }
});

test('maps evaluator source, tests, and LCOV into both Sonar scans', () => {
  const sources = [...workflow.matchAll(/-Dsonar\.sources=([^\n]+)/g)].map((match) => match[1]);
  const tests = [...workflow.matchAll(/-Dsonar\.tests=([^\n]+)/g)].map((match) => match[1]);
  const lcov = [...workflow.matchAll(/-Dsonar\.(?:javascript|typescript)\.lcov\.reportPaths=([^\n]+)/g)].map((match) => match[1]);
  const sonarSetup = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const testJob = workflow.match(/\n  test:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';

  assert.equal(sources.length, 2, 'both Sonar scans must declare sources');
  assert.equal(tests.length, 2, 'both Sonar scans must declare tests');
  for (const value of [...sources, ...tests]) assert.ok(value.split(',').includes('toggly-eval'));
  assert.equal(lcov.length, 4, 'both scanners must receive JavaScript and TypeScript LCOV paths');
  for (const value of lcov) assert.equal(value, 'coverage/*-lcov.info');
  assert.match(sonarSetup, /\["Evaluator"\]="toggly-eval"/);
  const analysisInstall = sonarSetup.match(/for dir in \\\n([\s\S]*?)toggly-appinsights-hook; do/)?.[1] ?? '';
  assert.ok(analysisInstall.includes('toggly-eval'));
  assert.match(testJob, /matrix\.sdk == 'Evaluator'/);
});

test('maps local gates source, tests, and LCOV into both Sonar scans', () => {
  const sources = [...workflow.matchAll(/-Dsonar\.sources=([^\n]+)/g)].map((match) => match[1]);
  const tests = [...workflow.matchAll(/-Dsonar\.tests=([^\n]+)/g)].map((match) => match[1]);
  const sonarSetup = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const testJob = workflow.match(/\n  test:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';

  assert.equal(sources.length, 2, 'both Sonar scans must declare sources');
  assert.equal(tests.length, 2, 'both Sonar scans must declare tests');
  for (const value of [...sources, ...tests]) {
    assert.ok(value.split(',').includes('toggly-local-gates/src'));
    assert.ok(!value.split(',').includes('toggly-local-gates'));
  }
  assert.match(sonarSetup, /\["Local-Gates"\]="toggly-local-gates"/);
  assert.match(testJob, /matrix\.sdk == 'Local-Gates'/);
  assert.match(testJob, /name: coverage-\$\{\{ matrix\.sdk \}\}/);
  assert.match(sonarSetup, /-Dsonar\.test\.inclusions=.*\*\*\/\*\.spec\.ts/);
});

test('runs evaluator through only its locked dependency install', () => {
  const testJob = workflow.match(/\n  test:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const installSteps = [...testJob.matchAll(/\n      - name: (Install [^\n]+)\n([\s\S]*?)(?=\n      - name:|$)/g)].map(([, name, body]) => ({
    name,
    guard: body.match(/^        if: ([^\n]+)/m)?.[1] ?? '',
    command: body.match(/^        run: ([^\n]+)/m)?.[1] ?? '',
  }));
  const guardSelectsSdk = (guard, sdk) => {
    const included = [...guard.matchAll(/matrix\.sdk == '([^']+)'/g)].map(([, name]) => name);
    const excluded = [...guard.matchAll(/matrix\.sdk != '([^']+)'/g)].map(([, name]) => name);
    return (included.length === 0 || included.includes(sdk)) && !excluded.includes(sdk);
  };

  const evaluatorInstalls = installSteps.filter((step) => guardSelectsSdk(step.guard, 'Evaluator'));
  assert.deepEqual(evaluatorInstalls.map(({ name, command }) => ({ name, command })), [{
    name: 'Install locked standalone package dependencies',
    command: 'npm ci',
  }]);
});

test('classifies CJS files under tests as test code in both Sonar scans', () => {
  const scanExclusions = [...workflow.matchAll(/-Dsonar\.exclusions=([^\n]+)/g)].map((match) => match[1]);
  const testInclusions = [...workflow.matchAll(/-Dsonar\.test\.inclusions=([^\n]+)/g)].map((match) => match[1]);

  assert.equal(scanExclusions.length, 2, 'both Sonar scans must define source exclusions');
  assert.equal(testInclusions.length, 2, 'both Sonar scans must define test inclusions');
  for (const configuration of [...scanExclusions, ...testInclusions]) {
    assert.ok(configuration.includes('**/tests/**/*.cjs'));
  }
});

test('runs the Fastify 4 and 5 packed-host fixture on its valid Node 20 row', () => {
  const packedHostStep = workflow.match(/- name: Run packed host compatibility fixture\n\s+if: ([^\n]+)/)?.[1];

  assert.ok(packedHostStep, 'the packed-host fixture must keep an explicit matrix guard');
  assert.match(packedHostStep, /matrix\.config\.package == 'Fastify'/);
  assert.match(packedHostStep, /matrix\.node-version == '20\.x'/);
});

test('requires the packed Docusaurus production host with a locked Node 24 install', () => {
  const hostJob = workflow.match(/\n  test-docusaurus-host:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0];
  assert.ok(hostJob, 'the current Docusaurus host must run in CI');
  assert.match(hostJob, /node-version: '24\.x'/);
  assert.match(hostJob, /run: npm ci/);
  assert.match(hostJob, /run: npm run typecheck && npm run test:coverage/);
  assert.match(hostJob, /CHROME_BIN: \/usr\/bin\/google-chrome/);
  assert.match(hostJob, /run: node tests\/docusaurus-consumer-fixtures\/packed-host\.mjs/);
  assert.doesNotMatch(hostJob, /overlay-shared-js-deps|continue-on-error|npm ci \|\|/);
  assert.match(summary.match(/needs: \[([^\]]+)\]/)?.[1] ?? '', /\btest-docusaurus-host\b/);
  assert.match(hostJob, /if: needs\.prepare\.outputs\.run_test_docusaurus_host == 'true'/);
  assert.match(prepare, /run_test_docusaurus_host: \$\{\{ steps\.filter\.outputs\.run_test_docusaurus_host \}\}/);
  for (const sdks of ['all', 'Docusaurus']) {
    assertRequiredHost(sdks, 'test-docusaurus-host');
    assert.equal(selectAnalysis(sdks).runDocusaurusHost, 'true');
  }
  const pullRequest = workflow.match(/\n  pull_request:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  assert.match(pullRequest, /'tests\/docusaurus-consumer-fixtures\/\*\*'/);
  assert.match(workflow, /workflow_call:\s+inputs:\s+sdks:/);
  assert.match(docusaurusFixture, /const currentReact = '19\.3\.0'/);
  assert.ok(docusaurusFixture.includes('`react@${currentReact}`'));
  assert.ok(docusaurusFixture.includes('`react-dom@${currentReact}`'));
  assert.match(docusaurusFixture, /page\.on\('console'/);
  assert.match(docusaurusFixture, /consoleErrors/);
});

test('runs Pages Function coverage in the Docusaurus gate and maps it into both Sonar scans', () => {
  const hostJob = workflow.match(/\n  test-docusaurus-host:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const sonarJob = workflow.match(/\n  sonar:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  const pagesPath = 'toggly-docusaurus-edge-sdk/cloudflare/pages-function';

  assert.match(hostJob, /Install locked Pages Function dependencies/);
  assert.match(hostJob, new RegExp(`working-directory: ${pagesPath}\\s+run: npm ci`));
  assert.match(hostJob, /run: npm run typecheck && npm run lint && npm run test:coverage/);
  assert.match(hostJob, /name: coverage-Docusaurus-Pages/);
  assert.match(hostJob, new RegExp(`${pagesPath}/coverage/lcov\\.info`));
  assert.match(sonarJob, /needs: \[prepare, build-shared-js-deps, test, test-node-server, test-docusaurus-host, dependency-check\]/);
  assert.match(workflow, /\["Docusaurus-Pages"\]="toggly-docusaurus-edge-sdk\/cloudflare\/pages-function"/);

  const testInclusions = [...workflow.matchAll(/-Dsonar\.test\.inclusions=([^\n]+)/g)].map((match) => match[1]);
  const sourceExclusions = [...workflow.matchAll(/-Dsonar\.exclusions=([^\n]+)/g)].map((match) => match[1]);
  const coverageExclusions = [...workflow.matchAll(/-Dsonar\.coverage\.exclusions=([^\n]+)/g)].map((match) => match[1]);
  assert.equal(testInclusions.length, 2, 'both Sonar scans must classify Pages tests');
  assert.equal(sourceExclusions.length, 2, 'both Sonar scans must exclude Pages test tooling from source');
  assert.equal(coverageExclusions.length, 2, 'both Sonar scans must retain matching coverage exclusions');
  for (const value of testInclusions) assert.ok(value.includes(`${pagesPath}/tests/**`));
  for (const value of sourceExclusions) {
    assert.ok(value.includes(`${pagesPath}/tests/**`));
    assert.ok(value.includes(`${pagesPath}/scripts/**`));
  }
  for (const value of coverageExclusions) {
    assert.ok(value.includes('toggly-docusaurus-edge-sdk/cloudflare/worker/**'));
    assert.ok(!value.includes('toggly-docusaurus-edge-sdk/cloudflare/**'));
  }
});

test('excludes fixture and packaging lockfiles from the JS OWASP Node Audit scan', () => {
  const owasp = workflow.match(/\n  dependency-check:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0];
  assert.ok(owasp, 'javascript analysis must define an OWASP dependency-check job');
  assert.ok(owasp.includes("--exclude '**/host-fixtures/**'"));
  assert.ok(owasp.includes("--exclude '**/node_modules/**'"));
  assert.ok(owasp.includes("--exclude '**/packaging/**'"));
  assert.ok(owasp.includes('--disableNodeAudit'));
  assert.ok(owasp.includes('Toggly.FeatureManagement.Angular/projects/ngx-feature-flags-toggly'));
  assert.doesNotMatch(owasp, /path: >\s+Toggly\.FeatureManagement\.Angular\s/);
});

test('runs the current Gatsby packed host on Node 24', () => {
  assert.match(workflow, /'Toggly\.FeatureManagement\.Gatsby\/\*\*'/);
  for (const sdks of ['all', 'Gatsby']) {
    assert.deepEqual(selectAnalysis(sdks).testMatrix.include.filter(row => row.sdk === 'Gatsby'), [{
      sdk: 'Gatsby', path: 'Toggly.FeatureManagement.Gatsby',
      'test-cmd': 'npm run test:coverage && node tests/packed-host.mjs',
      'node-version': '24.x', 'has-lint': false,
    }]);
    assertRequiredHost(sdks, 'test');
  }
  assert.match(prepare, /test_matrix: \$\{\{ steps\.filter\.outputs\.test_matrix \}\}/);
  const testJob = workflow.match(/\n  test:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0] ?? '';
  assert.match(testJob, /matrix: \$\{\{ fromJson\(needs\.prepare\.outputs\.test_matrix\) \}\}/);
  assert.match(testJob, /node-version: \$\{\{ matrix\.node-version \|\| 'lts\/\*' \}\}/);
  assert.match(testJob, /run: \$\{\{ matrix\.test-cmd \}\}/);
  const install = testJob.match(/- name: Install locked standalone package dependencies\n[\s\S]*?(?=\n\s+- name:)/)?.[0] ?? '';
  assert.match(install, /if: matrix\.sdk == 'Gatsby' \|\|/);
  assert.match(install, /working-directory: \$\{\{ matrix\.path \}\}\s+run: npm ci/);
  assert.doesNotMatch(install, /continue-on-error|npm ci \|\|/);
});

test('runs Vue packed browser telemetry checks with an explicit Chrome executable', () => {
  const hostJob = workflow.match(/\n  test-current-browser-hosts:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0];
  assert.ok(hostJob);
  assert.match(hostJob, /CHROME_BIN: \/usr\/bin\/google-chrome/);
  assert.match(hostJob, /run: npm run test:host/);
});

test('runs the complete packed Angular host matrix in the required test job', () => {
  const testJob = workflow.slice(workflow.indexOf('\n  test:'), workflow.indexOf('\n  test-docusaurus-host:'));
  assert.match(testJob, /- name: Verify packed Angular consumers in Chrome\s+if: matrix\.sdk == 'Angular'\s+working-directory: \$\{\{ matrix\.path \}\}\s+env:\s+CHROME_BIN: \/usr\/bin\/google-chrome\s+run: \|\s+test -x "\$CHROME_BIN"\s+npm run test:hosts/);
});

test('canonical Svelte host check also runs the real browser matrix', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts['test:host'], 'node scripts/test-host.mjs && npm run test:browser-host');
  assert.equal(manifest.scripts['test:browser-host'], 'node scripts/test-browser-host.mjs');
});

test('selects system Chrome before packed Client-Core tests', () => {
  assert.match(
    workflow,
    /- name: Select system Chrome for packed Client Core\s+if: matrix\.sdk == 'Client-Core'/,
  );
  assert.match(workflow, /matrix\.sdk != 'Client-Core'/);
  assert.match(
    workflow,
    /if: matrix\.sdk == 'Gatsby' \|\| matrix\.sdk == 'Client-Telemetry' \|\| matrix\.sdk == 'Client-Core'/,
  );
});


test('classifies the JavaScript packed browser harness as test code in both scanners', () => {
  const harness = 'Toggly.FeatureManagement.Javascript/feature_flags_toggly/tests/packed-browser-host.mjs';
  for (const property of ['exclusions', 'test.inclusions']) {
    const values = [...workflow.matchAll(new RegExp('-Dsonar\\.' + property.replace('.', '\\.') + '=([^\\n]+)', 'g'))];
    assert.equal(values.length, 2);
    for (const [, value] of values) assert.ok(value.split(',').includes(harness), property);
  }
  for (const [, value] of workflow.matchAll(/-Dsonar\.coverage\.exclusions=([^\n]+)/g)) {
    assert.ok(!value.includes('Toggly.FeatureManagement.Javascript'));
  }
});

test('installs the packed Solid host browser with its own resolved Playwright CLI before verification', () => {
  const job = workflow.match(/\n  solidstart-host:[\s\S]*?(?=\n  [a-z][\w-]*:|$)/)?.[0] ?? '';
  assert.match(job, /run: node tests\/install-host\.mjs/);
  assert.doesNotMatch(job, /npx|cd tests\/host/);
  assertRequiredHost('SolidJS', 'solidstart-host');
  const installer = readFileSync(new URL('../../Toggly.FeatureManagement.Solid/tests/install-host.mjs', import.meta.url), 'utf8');
  const install = installer.indexOf("await run([join(work, 'node_modules/playwright/cli.js'), 'install', '--with-deps', 'chromium'])");
  const verify = installer.indexOf("await import(pathToFileURL(join(host, 'verify.mjs')).href)");
  const cleanInstall = installer.indexOf("await run([npm, 'ci'");
  assert.ok(cleanInstall >= 0, 'retain the genuine host npm ci');
  assert.ok(install > cleanInstall, 'install browsers after the genuine host npm ci');
  assert.ok(verify > install, 'install before native cleanup controls or host verification launch Chromium');
  assert.match(installer, /if \(!process\.env\.CHROMIUM_PATH\)/, 'retain an explicit local system Chromium override');
});
