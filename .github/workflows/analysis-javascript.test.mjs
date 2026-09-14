import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./analysis-javascript.yml', import.meta.url), 'utf8');
const summary = workflow.slice(workflow.indexOf('\n  summary:'));
const packedHostHarnesses = [
  'Toggly.FeatureManagement.Vue/vue-feature-flags-toggly/scripts/test-host.mjs',
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
