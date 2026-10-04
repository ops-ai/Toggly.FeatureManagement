import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { failedRequiredJobs } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-java.yml', import.meta.url), 'utf8');

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

test('Java Sonar ignores protocol SHA-1 kid on Es256Verifier (java:S4790)', () => {
  const sonar = job('sonar');
  for (const name of ['Build and run SonarCloud analysis', 'Run SonarQube Server analysis']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.issue\.ignore\.multicriteria=kidSha1/);
    assert.match(scan, /-Dsonar\.issue\.ignore\.multicriteria\.kidSha1\.ruleKey=java:S4790/);
    assert.match(scan, /-Dsonar\.issue\.ignore\.multicriteria\.kidSha1\.resourceKey=\*\*\/Es256Verifier\.java/);
  }
});

test('both Java scans use the pinned Maven scanner and await quality gates', () => {
  const sonar = job('sonar');
  for (const name of ['Build and run SonarCloud analysis', 'Run SonarQube Server analysis']) {
    const scan = step(sonar, name);
    assert.match(scan, /org\.sonarsource\.scanner\.maven:sonar-maven-plugin:5\.5\.0\.6356:sonar/);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /\|\| true|continue-on-error: true|-Pcoverage/);
  }
  assert.match(step(sonar, 'Run SonarQube Server analysis'), /if: \$\{\{ success\(\) \|\| failure\(\) \}\}/);
  assert.match(step(sonar, 'Download Dependency Check report (for SonarQube Server)'), /if: \$\{\{ success\(\) \|\| failure\(\) \}\}/);
});

test('reporting only skips Sonar and OWASP on fork PRs or release calls without reporting', () => {
  for (const name of ['sonar', 'dependency-check']) {
    const reporting = job(name);
    assert.match(reporting, /if:.*toJSON\(inputs\.run_reporting\) != 'false'/);
    assert.match(reporting, /github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.head\.repo\.fork/);
  }
});

test('the Java summary requires Sonar except for intentional reporting skips', () => {
  const summary = job('summary');
  assert.match(summary, /required-jobs: build,current-hosts,smoke-test,code-quality,coverage,sonar,dependency-check/);
  assert.match(summary, /allow-skipped:.*toJSON\(inputs\.run_reporting\) == 'false'/);
  assert.match(summary, /allow-skipped:.*github\.event_name == 'pull_request'.*github\.event\.pull_request\.head\.repo\.fork/);
  assert.match(summary, /allow-skipped:.*dependency-check,sonar/);
  assert.match(summary, /allow-skipped:.*\|\| 'none'/);

  const required = ['coverage', 'sonar', 'dependency-check'];
  const needs = {
    coverage: { result: 'success' },
    sonar: { result: 'failure' },
    'dependency-check': { result: 'success' },
  };
  assert.deepEqual(failedRequiredJobs(needs, required), ['sonar']);
  needs.sonar.result = 'skipped';
  needs['dependency-check'].result = 'skipped';
  assert.deepEqual(failedRequiredJobs(needs, required), ['sonar', 'dependency-check']);
  assert.deepEqual(failedRequiredJobs(needs, required, ['sonar', 'dependency-check']), []);
});

test('Java coverage uses the configured default JaCoCo plugin without a missing Maven profile', () => {
  const coverage = job('coverage');
  const sonar = job('sonar');
  assert.match(coverage, /mvn -B verify --file pom\.xml/);
  assert.doesNotMatch(coverage + sonar, /-Pcoverage/);
});
