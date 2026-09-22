import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { splitJobList, verifyRequiredJobs } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

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
const packedHostHarnesses = [
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/test-host.mjs',
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
