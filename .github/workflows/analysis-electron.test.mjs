import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { failedRequiredJobs, splitJobList } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-electron.yml', import.meta.url), 'utf8');
const verifierPath = fileURLToPath(new URL('../actions/verify-required-jobs/verify-required-jobs.mjs', import.meta.url));

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

function expression(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}: \\$\\{\\{ (.*) \\}\\}$`, 'm'));
  assert.ok(match, `missing ${key} expression`);
  return match[1];
}

// Evaluate the workflow's boolean expression subset, including Actions
// property names containing hyphens (which need bracket notation in JS).
// Missing Actions inputs serialize as an empty string, distinct from false.
function evaluate(source, context = {}) {
  return runInNewContext(source.replace(/\.([a-zA-Z_][\w]*-[\w-]+)/g, '["$1"]'), {
    inputs: { run_reporting: '' },
    github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: false } } } } },
    toJSON: JSON.stringify,
    always: () => true,
    success: () => true,
    failure: () => false,
    ...context,
  });
}

function runScript(source) {
  const block = source.match(/        run: \|\n([\s\S]*)/);
  if (block) return block[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const inline = source.match(/        run: (.+)/);
  assert.ok(inline, 'missing executable run script');
  return inline[1];
}

test('Electron credentials reject every missing credential without revealing token values', () => {
  const sonar = job('sonar');
  for (const [name, credentials] of [
    ['Validate SonarCloud credentials', ['SONAR_TOKEN']],
    ['Validate SonarQube Server credentials', ['SONAR_SERVER_TOKEN', 'SONAR_HOST_URL']],
  ]) {
    const validator = step(sonar, name);
    for (const credential of credentials) assert.match(validator, new RegExp(`secrets\\.${credential}`));
    for (const missing of [null, ...credentials]) {
      const env = Object.fromEntries(credentials.map(key => [key, key === missing ? '' : 'synthetic-private-value']));
      const result = spawnSync('bash', ['-e', '-c', runScript(validator)], { env, encoding: 'utf8' });
      assert.equal(result.status, missing ? 1 : 0, `${name}: ${missing ?? 'all present'}`);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-value/);
    }
  }
});

test('both Electron scanners wait for gates and propagate scanner or gate errors', () => {
  const sonar = job('sonar');
  assert.doesNotMatch(sonar.split('    steps:')[0], /continue-on-error/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
    assert.match(scan, /-Dsonar\.projectKey=toggly-sdks-electron/);
  }
});

test('Server validation and scanning remain available after Cloud failure and stop on invalid credentials or cancellation', () => {
  const sonar = job('sonar');
  const credentials = step(sonar, 'Validate SonarQube Server credentials');
  const scan = step(sonar, 'SonarQube Server Scan');
  const download = step(sonar, 'Download Dependency Check report');
  for (const [previousResult, valid, want] of [
    ['success', true, true], ['failure', true, true],
    ['failure', false, false], ['success', false, false], ['cancelled', true, false],
  ]) {
    const context = {
      success: () => previousResult === 'success',
      failure: () => previousResult === 'failure',
      steps: { 'validate-sonarqube-server-credentials': { outcome: valid ? 'success' : 'failure' } },
    };
    assert.equal(evaluate(expression(credentials, 'if'), context), previousResult !== 'cancelled');
    assert.equal(evaluate(expression(download, 'if'), context), previousResult !== 'cancelled');
    assert.equal(evaluate(expression(scan, 'if'), context), want);
  }
});

test('trusted events run reporting by default; only explicit false or a fork PR permits skips', () => {
  const summary = job('summary');
  assert.doesNotMatch(workflow, /pull_request_target/);
  for (const [eventName, fork, input, runs, allowed] of [
    ['pull_request', false, '', true, 'none'],
    ['workflow_dispatch', false, '', true, 'none'],
    ['workflow_call', false, true, true, 'none'],
    ['push', false, true, true, 'none'],
    ['pull_request', true, '', false, 'sonar,dependency-check'],
    ['workflow_call', false, false, false, 'sonar,dependency-check'],
    ['workflow_dispatch', false, false, false, 'sonar,dependency-check'],
    ['workflow_dispatch', true, '', true, 'none'],
  ]) {
    const context = {
      inputs: { run_reporting: input },
      github: { event_name: eventName, event: { pull_request: { head: { repo: { fork } } } } },
    };
    for (const name of ['sonar', 'dependency-check']) {
      assert.equal(evaluate(expression(job(name), 'if'), context), runs, `${name}: ${eventName}/${fork}/${input}`);
    }
    assert.equal(evaluate(expression(summary, 'allow-skipped'), context), allowed);
  }
});

test('the actual summary verifier rejects missing, failed, cancelled or unexpected skipped Sonar', () => {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  const allow = splitJobList(evaluate(expression(summary, 'allow-skipped')));
  for (const result of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
    const needs = { test: { result: 'success' }, sonar: { result }, 'dependency-check': { result: 'success' } };
    assert.deepEqual(failedRequiredJobs(needs, required, allow), result === 'success' ? [] : ['sonar']);
    const execution = spawnSync(process.execPath, [verifierPath], {
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), REQUIRED_JOBS: required.join(','), ALLOW_SKIPPED: allow.join(',') },
      encoding: 'utf8',
    });
    assert.equal(execution.status, result === 'success' ? 0 : 1, `sonar ${result}`);
  }
});

test('intentional reporting skips cannot hide failed scans or missing tests', () => {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  for (const context of [
    { inputs: { run_reporting: false } },
    { github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: true } } } } } },
  ]) {
    const allow = splitJobList(evaluate(expression(summary, 'allow-skipped'), context));
    const needs = { test: { result: 'success' }, sonar: { result: 'skipped' }, 'dependency-check': { result: 'skipped' } };
    assert.deepEqual(failedRequiredJobs(needs, required, allow), []);
    needs.sonar.result = 'failure';
    assert.deepEqual(failedRequiredJobs(needs, required, allow), ['sonar']);
    needs.sonar.result = 'skipped';
    delete needs.test;
    assert.deepEqual(failedRequiredJobs(needs, required, allow), ['test']);
  }
});

test('summary discloses fork and opt-out skips and preserves failed-job results', () => {
  const report = step(job('summary'), 'Check test results');
  assert.equal(evaluate(expression(report, 'if'), { success: () => false, failure: () => true }), true);
  const directory = mkdtempSync(join(tmpdir(), 'electron-summary-'));
  try {
    for (const [fork, input, want] of [
      [true, '', /Credentialed SonarCloud and SonarQube Server scans were skipped for this fork PR/],
      [false, false, /Reporting was explicitly disabled/],
      [false, '', /Sonar: failure/],
    ]) {
      const path = join(directory, 'summary.md');
      const context = {
        inputs: { run_reporting: input },
        github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork } } } } },
        needs: { test: { result: 'success' }, sonar: { result: 'failure' }, 'dependency-check': { result: 'success' } },
      };
      const env = Object.fromEntries(['FORK_PR', 'RUN_REPORTING', 'TEST_RESULT', 'SONAR_RESULT', 'DEPENDENCY_CHECK_RESULT']
        .map(key => [key, String(evaluate(expression(report, key), context))]));
      const result = spawnSync('bash', ['-e', '-c', runScript(report)], {
        env: { GITHUB_STEP_SUMMARY: path, ...env },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const output = readFileSync(path, 'utf8');
      assert.match(output, want);
      assert.doesNotMatch(output, /✅|authenticated gates passed/i);
      rmSync(path);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Electron workflow runs its contract checks and keeps the existing host and coverage gates', () => {
  const tests = job('test');
  assert.match(step(tests, 'Verify Electron analysis workflow contract'), /run: node --test \.github\/workflows\/analysis-electron\.test\.mjs/);
  assert.match(workflow.split('permissions:')[0], /'\.github\/workflows\/analysis-electron\.test\.mjs'/);
  assert.match(step(tests, 'Run tests with coverage'), /xvfb-run.*npm run test:coverage/);
  assert.match(step(tests, 'Run packed Electron floor and current hosts'), /xvfb-run.*npm run test:hosts/);
});
