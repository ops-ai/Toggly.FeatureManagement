import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { failedRequiredJobs, splitJobList } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-react-router.yml', import.meta.url), 'utf8');
const verifierPath = fileURLToPath(new URL('../actions/verify-required-jobs/verify-required-jobs.mjs', import.meta.url));
const requiredJobs = ['build-shared-js-deps', 'build-and-test', 'packed-host', 'sonar', 'dependency-check'];

function successfulNeeds() {
  return Object.fromEntries(requiredJobs.map(name => [name, { result: 'success' }]));
}

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

// This workflow uses a boolean Actions expression subset. Translate property
// names containing hyphens to JS bracket access and evaluate the actual text.
// Absent Actions inputs serialize as an empty string, distinct from false.
function evaluate(source, context = {}) {
  return runInNewContext(source.replace(/\.([a-zA-Z_][\w]*-[\w-]+)/g, '["$1"]'), {
    inputs: { run_reporting: '' },
    github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: false } } } } },
    toJSON: JSON.stringify,
    always: () => true,
    success: () => true,
    failure: () => false,
    cancelled: () => false,
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

test('React Router validators reject each missing credential without revealing values', () => {
  for (const [name, keys] of [
    ['Validate SonarCloud credentials', ['SONAR_TOKEN']],
    ['Validate SonarQube Server credentials', ['SONAR_SERVER_TOKEN', 'SONAR_HOST_URL']],
  ]) {
    const validator = step(job('sonar'), name);
    for (const key of keys) assert.match(validator, new RegExp(`secrets\\.${key}`));
    for (const missing of [null, ...keys, 'all']) {
      const env = Object.fromEntries(keys.map(key => [key, missing === key || missing === 'all' ? '' : 'synthetic-private-value']));
      const result = spawnSync('bash', ['-e', '-c', runScript(validator)], { env, encoding: 'utf8' });
      assert.equal(result.status, missing ? 1 : 0, `${name}: ${missing ?? 'all present'}`);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private-value/);
    }
  }
});

test('both React Router scans wait for gates and propagate scan or gate errors', () => {
  const sonar = job('sonar');
  assert.doesNotMatch(sonar.split('    steps:')[0], /continue-on-error/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
    assert.match(scan, /-Dsonar\.projectKey=toggly-sdks-react-router/);
  }
});

test('Server diagnoses Cloud failures only with valid credentials and stops on cancellation', () => {
  const sonar = job('sonar');
  const validator = step(sonar, 'Validate SonarQube Server credentials');
  const scan = step(sonar, 'SonarQube Server Scan');
  const download = step(sonar, 'Download Dependency Check report');
  for (const [previousResult, valid, want] of [
    ['success', true, true], ['failure', true, true],
    ['failure', false, false], ['success', false, false],
    ['cancelled', true, false], ['cancelled', false, false],
  ]) {
    const context = {
      success: () => previousResult === 'success',
      failure: () => previousResult === 'failure',
      cancelled: () => previousResult === 'cancelled',
      steps: { 'validate-sonarqube-server-credentials': { outcome: valid ? 'success' : 'failure' } },
    };
    assert.equal(evaluate(expression(validator, 'if'), context), previousResult !== 'cancelled');
    assert.equal(evaluate(expression(download, 'if'), context), previousResult !== 'cancelled');
    assert.equal(evaluate(expression(scan, 'if'), context), want);
  }
});

test('trusted reporting defaults to required; only explicit false or fork PRs allow skips', () => {
  assert.doesNotMatch(workflow, /pull_request_target/);
  for (const [eventName, fork, input, runs, allowed] of [
    ['pull_request', false, '', true, 'none'],
    ['workflow_dispatch', false, '', true, 'none'],
    ['workflow_call', false, true, true, 'none'],
    ['workflow_call', false, '', true, 'none'],
    ['workflow_call', false, undefined, true, 'none'],
    ['workflow_call', false, 'false', true, 'none'],
    ['pull_request', true, '', false, 'sonar,dependency-check'],
    ['workflow_call', false, false, false, 'sonar,dependency-check'],
    ['workflow_dispatch', false, false, false, 'sonar,dependency-check'],
    ['workflow_dispatch', true, '', true, 'none'],
  ]) {
    const context = {
      inputs: { run_reporting: input },
      github: { event_name: eventName, event: eventName === 'pull_request' ? { pull_request: { head: { repo: { fork } } } } : {} },
    };
    for (const name of ['sonar', 'dependency-check']) {
      assert.equal(evaluate(expression(job(name), 'if'), context), runs, `${name}: ${eventName}/${fork}/${input}`);
    }
    assert.equal(evaluate(expression(job('summary'), 'allow-skipped'), context), allowed);
  }
});

test('actual summary verifier rejects failed, cancelled, skipped or missing required jobs', () => {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  assert.deepEqual(required, requiredJobs);
  const allow = splitJobList(evaluate(expression(summary, 'allow-skipped')));
  for (const name of requiredJobs) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
      const needs = successfulNeeds();
      if (result === undefined) delete needs[name];
      else needs[name].result = result;
      assert.deepEqual(failedRequiredJobs(needs, required, allow), result === 'success' ? [] : [name]);
      const execution = spawnSync(process.execPath, [verifierPath], {
        env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), REQUIRED_JOBS: required.join(','), ALLOW_SKIPPED: allow.join(',') },
        encoding: 'utf8',
      });
      assert.equal(execution.status, result === 'success' ? 0 : 1, `${name} ${result}`);
    }
  }
  const needs = successfulNeeds();
  needs.sonar.result = 'failure';
  needs['dependency-check'].result = 'cancelled';
  assert.deepEqual(failedRequiredJobs(needs, required, allow), ['sonar', 'dependency-check']);
});

test('intentional reporting skips still reject failed reporting and missing builds or packed hosts', () => {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  for (const context of [
    { inputs: { run_reporting: false } },
    { github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: true } } } } } },
  ]) {
    const allow = splitJobList(evaluate(expression(summary, 'allow-skipped'), context));
    for (const [name, result, want] of [
      ['sonar', 'skipped', []], ['sonar', 'failure', ['sonar']],
      ['sonar', 'cancelled', ['sonar']], ['sonar', undefined, ['sonar']],
      ['dependency-check', 'failure', ['dependency-check']],
      ['build-shared-js-deps', undefined, ['build-shared-js-deps']], ['build-shared-js-deps', 'skipped', ['build-shared-js-deps']],
      ['build-and-test', undefined, ['build-and-test']], ['build-and-test', 'skipped', ['build-and-test']],
      ['packed-host', undefined, ['packed-host']], ['packed-host', 'skipped', ['packed-host']],
    ]) {
      const needs = successfulNeeds();
      needs.sonar.result = 'skipped';
      needs['dependency-check'].result = 'skipped';
      if (result === undefined) delete needs[name];
      else needs[name].result = result;
      assert.deepEqual(failedRequiredJobs(needs, required, allow), want);
    }
  }
});

test('summary renders truthful outcomes and discloses unchecked authenticated gates', () => {
  const report = step(job('summary'), 'Generate summary');
  assert.equal(evaluate(expression(report, 'if'), { success: () => false, failure: () => true }), true);
  const directory = mkdtempSync(join(tmpdir(), 'react-router-summary-'));
  try {
    for (const [fork, input, sonarResult, want] of [
      [true, '', 'skipped', /Credentialed SonarCloud and SonarQube Server scans were skipped for this fork PR/],
      [false, false, 'skipped', /Reporting was explicitly disabled/],
      [false, '', 'failure', /Sonar: failure/],
      [false, '', 'cancelled', /Sonar: cancelled/],
      [false, '', 'success', /Sonar: success/],
    ]) {
      const path = join(directory, 'summary.md');
      const context = {
        inputs: { run_reporting: input },
        github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork } } } } },
        needs: { ...successfulNeeds(), sonar: { result: sonarResult } },
      };
      const env = Object.fromEntries(['FORK_PR', 'RUN_REPORTING', 'SHARED_DEPS_RESULT', 'BUILD_RESULT', 'PACKED_HOST_RESULT', 'SONAR_RESULT', 'DEPENDENCY_CHECK_RESULT']
        .map(key => [key, String(evaluate(expression(report, key), context))]));
      const result = spawnSync('bash', ['-e', '-c', runScript(report)], {
        env: { GITHUB_STEP_SUMMARY: path, ...env }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const output = readFileSync(path, 'utf8');
      assert.match(output, want);
      assert.match(output, /Shared JS dependencies: success/);
      assert.match(output, /Build and tests: success/);
      assert.match(output, /Packed hosts: success/);
      assert.match(output, /OWASP: success/);
      if (fork || input === false) assert.match(output, /authenticated Sonar gates were not checked/);
      assert.doesNotMatch(output, /✅|authenticated gates passed/i);
      rmSync(path);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('React Router contract checks execute in the existing Node 20 job and trigger on changes', () => {
  const contract = step(job('build-and-test'), 'Verify React Router analysis workflow contract');
  assert.match(contract, /run: node --test \.github\/workflows\/analysis-react-router\.test\.mjs/);
  for (const [node, want] of [['18.x', false], ['20.x', true], ['22.x', false]]) {
    assert.equal(evaluate(expression(contract, 'if'), { matrix: { 'node-version': node } }), want);
  }
  assert.match(workflow.split('permissions:')[0], /'\.github\/workflows\/analysis-react-router\.test\.mjs'/);
});

test('cancellation blocks Server diagnostics even if an earlier step failed', () => {
  const sonar = job('sonar');
  const context = {
    success: () => false,
    failure: () => true,
    cancelled: () => true,
    steps: { 'validate-sonarqube-server-credentials': { outcome: 'success' } },
  };
  for (const name of ['Download Dependency Check report', 'Validate SonarQube Server credentials', 'SonarQube Server Scan']) {
    assert.equal(evaluate(expression(step(sonar, name), 'if'), context), false, name);
  }
});

test('preserves Node tests, both packed Router hosts, shared dependencies and coverage classification', () => {
  const tests = job('build-and-test');
  assert.match(tests, /node-version: \[18\.x, 20\.x, 22\.x\]/);
  const hosts = job('packed-host');
  assert.match(hosts, /host: router7-react18\n\s+node-version: '20'/);
  assert.match(hosts, /host: router8-react19\n\s+node-version: '22'/);
  assert.match(step(hosts, 'Verify packed host'), /run: npm run test:hosts/);
  assert.match(step(job('build-shared-js-deps'), 'Build shared packages'), /packages: signed-defs,eval,hooks-types,local-gates,segments/);
  assert.match(step(tests, 'Run tests with coverage'), /run: npm run test:coverage/);
  assert.match(step(tests, 'Upload coverage (Node 20 only)'), /name: coverage-react-router/);
  assert.match(
    step(tests, 'Install dependencies with local client-telemetry'),
    /uses: \.\/\.github\/actions\/install-local-client-telemetry/,
  );
  assert.match(
    step(hosts, 'Install dependencies with local client-telemetry'),
    /uses: \.\/\.github\/actions\/install-local-client-telemetry/,
  );
  const sonar = job('sonar');
  assert.match(step(sonar, 'Install dependencies for TypeScript analysis'), /run: npm ci \|\| npm install/);
  assert.match(step(sonar, 'Resolve Sonar project version'), /manifest: Toggly.FeatureManagement.ReactRouter\/react-router-toggly\/package.json/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /projectBaseDir: \$\{\{ env\.SDK_ROOT \}\}\/\$\{\{ env\.PKG \}\}/);
    assert.match(scan, /-Dsonar.projectVersion=\$\{\{ steps.sonar_version.outputs.version \}\}/);
    assert.match(scan, /-Dsonar.javascript.lcov.reportPaths=\.\.\/\.\.\/coverage\/all-lcov.info/);
    assert.match(scan, /-Dsonar.typescript.tsconfigPaths=tsconfig.json/);
    assert.match(scan, /-Dsonar.sources=src/);
    assert.match(scan, /-Dsonar.tests=tests/);
    if (name === 'SonarQube Server Scan') {
      assert.match(
        scan,
        /-Dsonar.dependencyCheck.reportPath=\.\.\/\.\.\/dependency-check-reports\/dependency-check-report.xml/,
      );
    }
    for (const key of ['exclusions', 'coverage.exclusions', 'test.inclusions']) {
      const value = scan.match(new RegExp(`-Dsonar\\.${key.replaceAll('.', '\\.')}=([^\\n]+)`))[1];
      for (const glob of ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx', '**/*.test.mjs']) {
        assert.ok(value.includes(glob), `${name} ${key}: ${glob}`);
      }
    }
  }
});
