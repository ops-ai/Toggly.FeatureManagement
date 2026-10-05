import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { failedRequiredJobs } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

// Fail-closed CI standard (OPS-1258): quality gates (clippy, cargo-audit,
// test steps) must not swallow failures via `continue-on-error: true`, and
// the jobs that catch those failures must be required by the Analysis
// Summary. See `.github/actions/verify-required-jobs` for how `required-jobs`
// is enforced.

const rustWorkflow = readFileSync(new URL('./analysis-rust.yml', import.meta.url), 'utf8');
const javaWorkflow = readFileSync(new URL('./analysis-java.yml', import.meta.url), 'utf8');
const iosWorkflow = readFileSync(new URL('./analysis-ios.yml', import.meta.url), 'utf8');

/**
 * Extract the raw YAML block for a named step, starting at its
 * `- name: <name>` line and ending right before the next `- name:` line (or
 * the next top-level job key). This intentionally works on the raw text
 * rather than a full YAML parse so it stays durable against unrelated
 * formatting changes elsewhere in the file.
 */
function stepBlock(workflow, stepName) {
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`- name: ${escaped}\\n([\\s\\S]*?)(?=\\n\\s*- name:|\\n {0,2}\\S[^\\n]*:\\n|$)`);
  const match = workflow.match(pattern);
  assert.ok(match, `expected to find a "${stepName}" step`);
  return match[0];
}

test('rust clippy step does not swallow failures with continue-on-error', () => {
  const block = stepBlock(rustWorkflow, 'Run clippy');
  assert.doesNotMatch(block, /continue-on-error/);
  assert.match(block, /-D warnings/);
});

test('rust cargo-audit step does not swallow failures with continue-on-error', () => {
  const block = stepBlock(rustWorkflow, 'Run security audit');
  assert.doesNotMatch(block, /continue-on-error/);
});

test('rust Analysis Summary requires the security (cargo-audit) job', () => {
  const summary = rustWorkflow.slice(rustWorkflow.indexOf('\n  summary:'));
  const requiredJobs = summary.match(/required-jobs: ([^\n]+)/)?.[1];
  assert.ok(requiredJobs, 'analysis summary must verify required jobs');
  assert.match(requiredJobs, /\bsecurity\b/);
});

test('rust coverage and Sonar analyze the exact pull request head', () => {
  const coverage = rustWorkflow.slice(rustWorkflow.indexOf('\n  coverage:'), rustWorkflow.indexOf('\n  docs:'));
  const sonar = rustWorkflow.slice(rustWorkflow.indexOf('\n  sonar:'), rustWorkflow.indexOf('\n  dependency-check:'));
  for (const job of [coverage, sonar]) {
    assert.match(stepBlock(job, 'Checkout code'), /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  }
  assert.match(stepBlock(coverage, 'Upload coverage artifact'), /if-no-files-found: error/);
  assert.doesNotMatch(stepBlock(sonar, 'Download coverage report'), /continue-on-error/);
  const conversion = stepBlock(sonar, 'Convert LCOV to SonarQube generic coverage format');
  assert.doesNotMatch(conversion, /continue-on-error/);
  assert.doesNotMatch(conversion, /skipping conversion/);
});

test('rust SonarCloud and Server scans require credentials and distinct quality gates', () => {
  const cloudCredentials = stepBlock(rustWorkflow, 'Validate SonarCloud credentials');
  const serverCredentials = stepBlock(rustWorkflow, 'Validate SonarQube Server credentials');
  const cloud = stepBlock(rustWorkflow, 'SonarCloud Scan');
  const server = stepBlock(rustWorkflow, 'SonarQube Server Scan');

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

test('rust Sonar is required except for intentional fork and non-reporting skips', () => {
  const sonar = rustWorkflow.slice(rustWorkflow.indexOf('\n  sonar:'), rustWorkflow.indexOf('\n  dependency-check:'));
  const summary = rustWorkflow.slice(rustWorkflow.indexOf('\n  summary:'));
  assert.match(sonar, /toJSON\(inputs\.run_reporting\) != 'false'/);
  assert.match(sonar, /github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.head\.repo\.fork/);
  assert.match(summary, /required-jobs: test,smoke-test,coverage,docs,msrv,security,sonar,dependency-check/);
  assert.match(summary, /allow-skipped:.*toJSON\(inputs\.run_reporting\) == 'false'/);
  assert.match(summary, /allow-skipped:.*github\.event_name == 'pull_request'.*github\.event\.pull_request\.head\.repo\.fork/);
  assert.match(summary, /allow-skipped:.*dependency-check,sonar/);
  assert.match(summary, /allow-skipped:.*\|\| 'none'/);

  const needs = { sonar: { result: 'failure' }, 'dependency-check': { result: 'success' } };
  assert.deepEqual(failedRequiredJobs(needs, ['sonar', 'dependency-check']), ['sonar']);
  needs.sonar.result = 'skipped';
  assert.deepEqual(failedRequiredJobs(needs, ['sonar', 'dependency-check']), ['sonar']);
  assert.deepEqual(failedRequiredJobs(needs, ['sonar', 'dependency-check'], ['sonar']), []);
});

test('java Run tests step does not swallow failures with continue-on-error', () => {
  const block = stepBlock(javaWorkflow, 'Run tests');
  assert.doesNotMatch(block, /continue-on-error/);
});

test('iOS SonarCloud and Server scans wait for distinct quality gates', () => {
    const cloud = stepBlock(iosWorkflow, 'SonarCloud Scan');
    const server = stepBlock(iosWorkflow, 'SonarQube Server Scan');

    assert.match(cloud, /SONAR_HOST_URL: https:\/\/sonarcloud\.io/);
    assert.match(cloud, /-Dsonar\.organization=ops-ai/);
    assert.match(cloud, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(cloud, /continue-on-error/);

    assert.match(server, /SONAR_HOST_URL: \$\{\{ secrets\.SONAR_HOST_URL \}\}/);
    assert.doesNotMatch(server, /-Dsonar\.organization=ops-ai/);
    assert.match(server, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(server, /continue-on-error/);
});

test('iOS Analysis Summary requires the Sonar job', () => {
    const summary = iosWorkflow.slice(iosWorkflow.indexOf('\n  summary:'));
    const requiredJobs = summary.match(/required-jobs: ([^\n]+)/)?.[1];
    assert.ok(requiredJobs, 'analysis summary must verify required jobs');
    assert.match(requiredJobs, /\bsonar\b/);
});
