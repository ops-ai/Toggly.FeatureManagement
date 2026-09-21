import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./analysis-javascript.yml', import.meta.url), 'utf8');
const docusaurusFixture = readFileSync(
  new URL('../../tests/docusaurus-consumer-fixtures/packed-host.mjs', import.meta.url),
  'utf8',
);
const summary = workflow.slice(workflow.indexOf('\n  summary:'));
const packedHostHarnesses = [
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/test-host.mjs',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/browser-check.mjs',
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/tests/host/**',
  'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/scripts/test-host.mjs',
  'Toggly.FeatureManagement.Svelte/svelte-feature-flags-toggly/tests/host/**'
];

test('requires current packed browser-host validation in the analysis summary', () => {
  const needs = summary.match(/needs: \[([^\]]+)\]/)?.[1];
  const requiredJobs = summary.match(/required-jobs: ([^\n]+)/)?.[1];

  assert.ok(needs, 'analysis summary must declare its required jobs');
  assert.ok(requiredJobs, 'analysis summary must verify required jobs');
  assert.match(needs, /\btest-current-browser-hosts\b/);
  assert.match(requiredJobs, /\btest-current-browser-hosts\b/);
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
  assert.match(summary.match(/required-jobs: ([^\n]+)/)?.[1] ?? '', /\btest-docusaurus-host\b/);
  assert.equal((workflow.match(/'tests\/docusaurus-consumer-fixtures\/\*\*'/g) ?? []).length, 2);
  assert.match(docusaurusFixture, /react@19\.3\.0/);
  assert.match(docusaurusFixture, /react-dom@19\.3\.0/);
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
  assert.match(
    workflow,
    /- sdk: Gatsby\s+path: Toggly\.FeatureManagement\.Gatsby\s+test-cmd: npm run test:coverage && node tests\/packed-host\.mjs\s+node-version: '24\.x'/,
  );
  assert.match(
    workflow,
    /- name: Install locked Gatsby dependencies\s+if: matrix\.sdk == 'Gatsby'\s+working-directory: \$\{\{ matrix\.path \}\}\s+run: npm ci/,
  );
});

test('runs Vue packed browser telemetry checks with an explicit Chrome executable', () => {
  const hostJob = workflow.match(/\n  test-current-browser-hosts:[\s\S]*?(?=\n  [a-z][\w-]*:)/)?.[0];
  assert.ok(hostJob);
  assert.match(hostJob, /CHROME_BIN: \/usr\/bin\/google-chrome/);
  assert.match(hostJob, /run: npm run test:host/);
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
