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
    const needs = {
      test: { result: 'success' },
      'packed-host': { result: 'success' },
      sonar: { result },
      'dependency-check': { result: 'success' },
    };
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
    const needs = {
      test: { result: 'success' },
      'packed-host': { result: 'success' },
      sonar: { result: 'skipped' },
      'dependency-check': { result: 'skipped' },
    };
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
        needs: {
          test: { result: 'success' },
          'packed-host': { result: 'success' },
          sonar: { result: 'failure' },
          'dependency-check': { result: 'success' },
        },
      };
      const env = Object.fromEntries(['FORK_PR', 'RUN_REPORTING', 'TEST_RESULT', 'PACKED_HOST_RESULT', 'SONAR_RESULT', 'DEPENDENCY_CHECK_RESULT']
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

test('Electron workflow runs Node 22/24/26 coverage and packed Electron 28/45 hosts', () => {
  const tests = job('test');
  assert.match(tests, /node-version: \[22\.x, 24\.x, 26\.x\]/);
  assert.match(step(tests, 'Verify Electron analysis workflow contract'), /run: node --test \.github\/workflows\/analysis-electron\.test\.mjs/);
  assert.match(step(tests, 'Verify Electron analysis workflow contract'), /matrix\.node-version == '22\.x'/);
  assert.match(workflow.split('permissions:')[0], /'\.github\/workflows\/analysis-electron\.test\.mjs'/);
  assert.match(step(tests, 'Run tests with coverage'), /xvfb-run.*npm run test:coverage/);
  assert.match(step(tests, 'Upload coverage artifact'), /matrix\.node-version == '22\.x'/);

  const hosts = job('packed-host');
  assert.match(hosts, /host: electron28-retained-floor\n\s+node-version: '24'/);
  assert.match(hosts, /host: electron45-current\n\s+node-version: '24'/);
  assert.match(step(hosts, 'Run packed Electron host'), /xvfb-run.*npm run test:hosts/);
  assert.match(step(hosts, 'Run packed Electron host'), /HOST: \$\{\{ matrix\.host \}\}/);

  const summary = job('summary');
  assert.match(summary, /required-jobs: test,packed-host,sonar,dependency-check/);
  assert.match(step(summary, 'Check test results'), /Packed hosts: \$\{PACKED_HOST_RESULT\}/);
  assert.match(step(summary, 'Check test results'), /Node: 22\.x, 24\.x, 26\.x/);
  assert.match(step(summary, 'Check test results'), /28\.3\.3 \(floor\), 45\.2\.1 \(latest\)/);
});

// Sonar resolves report paths from projectBaseDir. Electron sits one directory
// below the checkout, and the organized reports live at the checkout root.
function repoRelative(baseDir, reportPath) {
  const parts = [];
  for (const part of `${baseDir}/${reportPath}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      assert.ok(parts.length > 0, `${reportPath} escapes the checkout from ${baseDir}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

test('Electron coverage and dependency-check reports resolve inside the checkout', () => {
  const sonar = job('sonar');
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    const base = scan.match(/projectBaseDir: (\S+)/)[1];
    assert.equal(base, 'Toggly.FeatureManagement.Electron');
    for (const key of ['javascript', 'typescript']) {
      const report = scan.match(new RegExp(`-Dsonar\\.${key}\\.lcov\\.reportPaths=(\\S+)`))[1];
      assert.equal(repoRelative(base, report), 'coverage/Electron-lcov.info', `${name} ${key}`);
    }
  }
  const dependencyCheck = step(sonar, 'SonarQube Server Scan').match(/-Dsonar\.dependencyCheck\.reportPath=(\S+)/)[1];
  assert.equal(
    repoRelative('Toggly.FeatureManagement.Electron', dependencyCheck),
    'dependency-check-reports/dependency-check-report.xml',
  );
});
