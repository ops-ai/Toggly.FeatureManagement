import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { failedRequiredJobs } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-nuxt.yml', import.meta.url), 'utf8');

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const next = workflow.slice(start + 1).search(/\n  [a-z][a-z-]*:\n/);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

function step(source, name) {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const next = source.indexOf('\n      - name:', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test('Nuxt Sonar scans fail closed on missing credentials, scanner errors, and failed quality gates', () => {
  const sonar = job('sonar');
  assert.match(step(sonar, 'Validate SonarCloud credentials'), /test -n "\$\{SONAR_TOKEN\}"/);
  assert.match(step(sonar, 'Validate SonarQube Server credentials'), /test -n "\$\{SONAR_SERVER_TOKEN\}" && test -n "\$\{SONAR_HOST_URL\}"/);

  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /continue-on-error: true|\|\| true/);
  }

  assert.match(step(sonar, 'SonarQube Server Scan'), /if: \$\{\{ success\(\) \|\| failure\(\) \}\}/);
});

function reportingIsSkipped(serializedRunReportingInput) {
  return serializedRunReportingInput === 'false';
}

test('Nuxt reporting jobs skip only when run_reporting is explicitly false', () => {
  const sonar = job('sonar');
  const dependencyCheck = job('dependency-check');
  const summary = job('summary');

  for (const reportingJob of [sonar, dependencyCheck]) {
    assert.match(reportingJob, /toJSON\(inputs\.run_reporting\) != 'false'/);
    assert.doesNotMatch(reportingJob, /github\.event_name != 'workflow_call'/);
  }
  assert.match(summary, /toJSON\(inputs\.run_reporting\) == 'false'/);
  assert.doesNotMatch(summary, /github\.event_name == 'workflow_call'/);

  for (const eventName of ['push', 'workflow_dispatch']) {
    assert.equal(reportingIsSkipped('false'), true, `${eventName} release call skips reporting`);
  }
  for (const eventName of ['pull_request', 'workflow_dispatch']) {
    assert.equal(reportingIsSkipped(''), false, `${eventName} direct analysis runs reporting`);
  }
});

test('Nuxt summary requires Sonar and permits only explicit reporting skips', () => {
  const summary = job('summary');
  assert.match(summary, /required-jobs: test,smoke-test,packed-host,sonar,dependency-check/);
  assert.match(summary, /allow-skipped: \$\{\{ toJSON\(inputs\.run_reporting\) == 'false' && 'sonar,dependency-check' \|\| 'none' \}\}/);

  const needs = {
    test: { result: 'success' },
    'smoke-test': { result: 'success' },
    'packed-host': { result: 'success' },
    sonar: { result: 'failure' },
    'dependency-check': { result: 'success' },
  };
  const required = ['test', 'smoke-test', 'packed-host', 'sonar', 'dependency-check'];
  assert.deepEqual(failedRequiredJobs(needs, required), ['sonar']);
  needs.sonar.result = 'skipped';
  needs['dependency-check'].result = 'skipped';
  assert.deepEqual(failedRequiredJobs(needs, required), ['sonar', 'dependency-check']);
  assert.deepEqual(failedRequiredJobs(needs, required, ['sonar', 'dependency-check']), []);
});
