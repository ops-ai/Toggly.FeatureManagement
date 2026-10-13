import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { splitJobList } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-flutter.yml', import.meta.url), 'utf8');
const verifierPath = fileURLToPath(new URL('../actions/verify-required-jobs/verify-required-jobs.mjs', import.meta.url));
const requiredJobs = ['analyze', 'sonar', 'build-platforms', 'smoke-test', 'dependency-check', 'analyze-providers', 'secure-storage-version-matrix', 'dependency-check-providers'];
const reportingJobs = ['sonar', 'dependency-check', 'dependency-check-providers'];
const outcomes = [
  ['analyze', 'ANALYZE_RESULT', 'Core tests and analysis'], ['sonar', 'SONAR_RESULT', 'Core Sonar'],
  ['build-platforms', 'BUILD_RESULT', 'Core platform builds'], ['smoke-test', 'SMOKE_RESULT', 'Smoke test'],
  ['dependency-check', 'DEPENDENCY_CHECK_RESULT', 'Core OWASP'],
  ['analyze-providers', 'PROVIDERS_RESULT', 'Provider tests, analysis and requested Sonar'],
  ['secure-storage-version-matrix', 'SECURE_STORAGE_RESULT', 'Secure Storage plugin compatibility'],
  ['dependency-check-providers', 'PROVIDERS_DEPENDENCY_CHECK_RESULT', 'Provider OWASP'],
];

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

// Execute the actual workflow boolean subset, translating Actions identifiers
// with hyphens. Missing reporting inputs are distinct from boolean false.
function evaluate(source, context = {}) {
  return runInNewContext(source.replace(/\.([a-zA-Z_][\w]*-[\w-]+)/g, '["$1"]'), {
    inputs: { run_reporting: '', bootstrap_server_main: false },
    github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: false } } } } },
    toJSON: JSON.stringify, always: () => true, success: () => true,
    failure: () => false, cancelled: () => false,
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

function successfulNeeds() {
  return Object.fromEntries(requiredJobs.map(name => [name, { result: 'success' }]));
}

function summaryRequirements(context = {}) {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  assert.deepEqual(required, requiredJobs);
  return { required, allowed: splitJobList(evaluate(expression(summary, 'allow-skipped'), context)) };
}

function verify(needs, { required, allowed }) {
  return spawnSync(process.execPath, [verifierPath], {
    env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), REQUIRED_JOBS: required.join(','), ALLOW_SKIPPED: allowed.join(',') },
    encoding: 'utf8',
  });
}

function generateSummary(context) {
  const report = step(job('summary'), 'Generate summary');
  const env = Object.fromEntries([...outcomes.map(([, key]) => key), 'FORK_PR', 'RUN_REPORTING']
    .map(key => [key, String(evaluate(expression(report, key), context))]));
  const directory = mkdtempSync(join(tmpdir(), 'flutter-summary-'));
  const path = join(directory, 'summary with spaces.md');
  try {
    const execution = spawnSync('bash', ['-e', '-c', runScript(report)], {
      env: { GITHUB_STEP_SUMMARY: path, ...env }, encoding: 'utf8',
    });
    assert.equal(execution.status, 0, execution.stderr);
    return readFileSync(path, 'utf8');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('core and provider validators reject every missing credential without revealing values', () => {
  for (const jobName of ['sonar', 'analyze-providers']) {
    for (const [name, keys] of [
      ['Validate SonarCloud credentials', ['SONAR_TOKEN']],
      ['Validate SonarQube Server credentials', ['SONAR_SERVER_TOKEN', 'SONAR_HOST_URL']],
    ]) {
      const validator = step(job(jobName), name);
      assert.doesNotMatch(validator, /continue-on-error/);
      for (const key of keys) assert.match(validator, new RegExp(`secrets\\.${key}`));
      for (const missing of [null, ...keys, 'all']) {
        const env = Object.fromEntries(keys.map(key => [key, key === missing || missing === 'all' ? '' : 'synthetic-private-value']));
        const execution = spawnSync('bash', ['-e', '-c', runScript(validator)], { env, encoding: 'utf8' });
        assert.equal(execution.status, missing ? 1 : 0, `${jobName}/${name}: ${missing ?? 'all present'}`);
        assert.doesNotMatch(execution.stdout + execution.stderr, /synthetic-private-value/);
      }
    }
  }
});

test('core and all four provider scanners wait for fatal gates with existing classification', () => {
  for (const jobName of ['sonar', 'analyze-providers']) {
    const source = job(jobName);
    assert.doesNotMatch(source.split('    steps:')[0], /continue-on-error/);
    const core = jobName === 'sonar';
    for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
      const scan = step(source, name);
      assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
      assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
      for (const arg of [
        'SonarSource/sonarqube-scan-action@v8.3.0',
        `projectBaseDir: Toggly.FeatureManagement.Flutter/${core ? 'toggly' : '${{ matrix.dir }}'}`,
        `-Dsonar.projectKey=${core ? 'toggly-sdks-flutter' : '${{ matrix.sonarKey }}'}`,
        '-Dsonar.projectVersion=${{ steps.sonar_version.outputs.version }}',
        '-Dsonar.sources=lib', '-Dsonar.tests=test', '-Dsonar.dart.lcov.reportPaths=coverage/lcov.info',
        `-Dsonar.exclusions=**/.*/**,**/example/**,${core ? '**/benchmark/**,' : ''}**/*.g.dart,**/*.freezed.dart`,
      ]) assert.ok(scan.includes(arg), `${jobName}/${name}: ${arg}`);
    }
    assert.match(step(source, 'SonarCloud Scan'), /-Dsonar.organization=ops-ai/);
    assert.ok(step(source, 'Resolve Sonar project version').includes(`manifest: Toggly.FeatureManagement.Flutter/${core ? 'toggly' : '${{ matrix.dir }}'}/pubspec.yaml`));
  }
  assert.match(step(job('sonar'), 'SonarQube Server Scan'), /-Dsonar.dart.analyzer.options.override=false/);
  assert.match(step(job('sonar'), 'SonarQube Server Scan'), /-Dsonar.dependencyCheck.reportPath=\.\.\/\.\.\/dependency-check-reports\/dependency-check-report.xml/);
  const providers = job('analyze-providers').split('    steps:')[0];
  assert.equal((providers.match(/sonarKey:/g) ?? []).length, 4);
  for (const key of ['secure-storage', 'disk', 'sqlite', 'isar']) assert.ok(providers.includes(`sonarKey: toggly-sdks-flutter-${key}`));
});

test('Server diagnostics survive prior failures only after validation and without cancellation', () => {
  for (const jobName of ['sonar', 'analyze-providers']) {
    const source = job(jobName);
    assert.match(step(source, 'Validate SonarQube Server credentials'), /id: validate-sonarqube-server-credentials/);
    for (const [previous, valid, cancelled, want] of [
      ['success', true, false, true], ['failure', true, false, true],
      ['success', false, false, false], ['failure', false, false, false],
      ['cancelled', true, true, false], ['failure', true, true, false],
      ['success', true, true, false], ['failure', false, true, false],
    ]) {
      const context = {
        success: () => previous === 'success', failure: () => previous === 'failure', cancelled: () => cancelled,
        steps: { 'validate-sonarqube-server-credentials': { outcome: valid ? 'success' : 'failure' } },
      };
      assert.equal(evaluate(expression(step(source, 'Validate SonarQube Server credentials'), 'if'), context), !cancelled);
      assert.equal(evaluate(expression(step(source, 'SonarQube Server Scan'), 'if'), context), want);
      if (jobName === 'sonar') assert.equal(evaluate(expression(step(source, 'Download Dependency Check report (for SonarQube Server)'), 'if'), context), !cancelled);
    }
  }
});

test('forks and explicit reporting opt-out skip credentialed work while provider runtime still runs', () => {
  assert.doesNotMatch(workflow, /pull_request_target/);
  for (const [eventName, fork, input, runs, allowed] of [
    ['pull_request', false, '', true, 'none'], ['workflow_dispatch', false, '', true, 'none'],
    ['workflow_call', false, true, true, 'none'], ['workflow_call', false, '', true, 'none'],
    ['workflow_call', false, undefined, true, 'none'], ['workflow_call', false, 'false', true, 'none'],
    ['pull_request', true, '', false, 'sonar,dependency-check,dependency-check-providers'],
    ['workflow_call', false, false, false, 'sonar,dependency-check,dependency-check-providers'],
    ['workflow_dispatch', false, false, false, 'sonar,dependency-check,dependency-check-providers'],
    ['workflow_dispatch', true, '', true, 'none'],
  ]) {
    const context = { inputs: { run_reporting: input, bootstrap_server_main: false }, github: {
      event_name: eventName, event: eventName === 'pull_request' ? { pull_request: { head: { repo: { fork } } } } : {},
    }, steps: { 'validate-sonarqube-server-credentials': { outcome: 'success' } } };
    for (const name of reportingJobs) assert.equal(evaluate(expression(job(name), 'if'), context), runs, name);
    for (const name of requiredJobs.filter(name => !reportingJobs.includes(name))) assert.equal(evaluate(expression(job(name), 'if'), context), true, name);
    for (const name of ['Validate SonarCloud credentials', 'SonarCloud Scan', 'Validate SonarQube Server credentials', 'SonarQube Server Scan']) {
      assert.equal(evaluate(expression(step(job('analyze-providers'), name), 'if'), context), runs, `${name}: ${eventName}/${fork}/${input}`);
    }
    // Diagnostic status functions must not bypass credentialed-work opt-out.
    for (const name of ['Validate SonarQube Server credentials', 'SonarQube Server Scan']) {
      assert.equal(evaluate(expression(step(job('analyze-providers'), name), 'if'), {
        ...context, success: () => false, failure: () => true,
      }), runs, `${name} after earlier failure: ${eventName}/${fork}/${input}`);
    }
    assert.equal(evaluate(expression(job('summary'), 'allow-skipped'), context), allowed);
  }
  for (const name of ['Apply monorepo pubspec overrides', 'Get dependencies', 'Run code generation (if needed)', 'Analyze code', 'Check formatting', 'Run tests with coverage', 'Upload coverage artifact']) {
    assert.doesNotMatch(step(job('analyze-providers'), name), /run_reporting|repo\.fork/);
  }
});

test('summary requires all eight jobs and rejects failure cancellation missing and unexpected skips', () => {
  const requirements = summaryRequirements();
  const dependencies = job('summary').match(/needs: \[([^\]]+)\]/)[1].split(',').map(name => name.trim());
  assert.deepEqual(new Set(dependencies), new Set(requiredJobs));
  for (const name of requiredJobs) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', 'unknown', undefined]) {
      const needs = successfulNeeds();
      if (result === undefined) delete needs[name];
      else needs[name].result = result;
      const execution = verify(needs, requirements);
      assert.equal(execution.status, result === 'success' ? 0 : 1, `${name}: ${result}`);
      if (result !== 'success') assert.ok(execution.stderr.includes(`${name}: ${result ?? 'missing'}`));
    }
  }
});

test('permitted reporting skips never tolerate failed reporting or skipped provider runtime', () => {
  for (const context of [
    { inputs: { run_reporting: false } },
    { github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: true } } } } } },
  ]) {
    const requirements = summaryRequirements(context);
    const skipped = successfulNeeds();
    for (const name of reportingJobs) skipped[name].result = 'skipped';
    assert.equal(verify(skipped, requirements).status, 0);
    for (const name of requiredJobs) {
      for (const result of ['failure', 'cancelled', 'skipped', 'unknown', undefined]) {
        const needs = structuredClone(skipped);
        if (result === undefined) delete needs[name];
        else needs[name].result = result;
        assert.equal(verify(needs, requirements).status, reportingJobs.includes(name) && result === 'skipped' ? 0 : 1, `${name}: ${result}`);
      }
    }
  }
});

test('summary runs after verification failure and emits actual results without blanket success', () => {
  assert.equal(evaluate(expression(step(job('summary'), 'Generate summary'), 'if'), { success: () => false, failure: () => true }), true);
  for (const [changed] of outcomes) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = successfulNeeds();
      needs[changed].result = result;
      const output = generateSummary({ needs });
      for (const [name, , label] of outcomes) assert.ok(output.includes(`${label}: ${name === changed ? result : 'success'}`), `${name}: ${output}`);
      assert.doesNotMatch(output, /✅|workflow completed|checks passed|builds tested/i);
    }
  }
});

test('summary discloses unchecked core and all provider gates despite provider runtime success', () => {
  for (const [fork, input, reason] of [[true, '', /skipped for this fork PR/], [false, false, /Reporting was explicitly disabled/]]) {
    const needs = successfulNeeds();
    for (const name of reportingJobs) needs[name].result = 'skipped';
    const output = generateSummary({ needs, inputs: { run_reporting: input },
      github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork } } } } },
    });
    assert.match(output, reason);
    assert.match(output, /core and all four provider authenticated Sonar gates were not checked/);
    assert.match(output, /OWASP reporting was also skipped/);
    assert.match(output, /Provider tests, analysis and requested Sonar: success/);
    assert.match(output, /provider runtime success does not prove provider Sonar gates/i);
  }
});

test('gate regressions run in the existing analyze job and trigger both push and PR checks', () => {
  assert.equal((workflow.split('jobs:')[0].match(/'\.github\/workflows\/analysis-flutter.test.mjs'/g) ?? []).length, 2);
  assert.match(step(job('analyze'), 'Setup Node for workflow tests'), /node-version: '24'/);
  const contract = step(job('analyze'), 'Test workflow gate behavior');
  assert.match(contract, /working-directory: \./);
  assert.match(contract, /run: node --test \.github\/workflows\/analysis-flutter.test.mjs/);
});

// Freeze excluded jobs from OPS-1773 base a0535a5: changing the main baseline
// or platform/compatibility runtimes is outside this PR's authorization.
test('main baseline platform smoke and plugin major jobs stay byte-for-byte preserved', () => {
  const hash = source => createHash('sha256').update(source).digest('hex');
  for (const [name, expected] of [
    ['provider-server-main', 'c7b672bc590b9af3cedd16e145794a530fe0f0d1f8414b617152ca3e9aa4ce87'],
    ['build-platforms', '5d699a2a19a5b080ece4ab4267b838b9284e1817a9534ce51e1984b2f897ca17'],
    ['smoke-test', 'bf0105fcf5cd71216b2cf4918238b9334db243ca84416a5e486d7900f80071ed'],
    ['secure-storage-version-matrix', '9311d1241e885378c7be7c0c3279e8224efa12dd88ae3be180b337c30465b1f2'],
  ]) assert.equal(hash(job(name)), expected, name);
  assert.equal(hash(job('analyze-providers').split('    steps:')[0]), '4fae063b0bcc707f6c9cd3b82d1da514f74219fe3ffe435e51ec10e75e43285a');
  assert.equal(hash(job('analyze-providers').split('      - name: Resolve Sonar project version\n')[0]), 'ec05b7e9bfb21c5f729cb64fd5102fcf4b726f4bec97b1737f6046550c4e64d9');
  for (const [eventName, bootstrap, expected] of [['push', false, true], ['workflow_dispatch', true, true], ['workflow_dispatch', false, false], ['pull_request', true, false], ['workflow_call', true, false]]) {
    assert.equal(evaluate(expression(job('provider-server-main'), 'if'), { inputs: { bootstrap_server_main: bootstrap }, github: { event_name: eventName } }), expected);
  }
  for (const context of [{ inputs: { bootstrap_server_main: true } }, { github: { event_name: 'push' } }]) {
    for (const name of [...requiredJobs, 'summary']) assert.equal(evaluate(expression(job(name), 'if'), context), false, name);
  }
});

test('core and provider runtime coverage artifacts overrides and trusted OWASP stay intact', () => {
  for (const name of ['analyze', 'analyze-providers']) {
    const source = job(name);
    assert.match(step(source, 'Analyze code'), /flutter analyze --no-fatal-infos --no-fatal-warnings/);
    assert.match(step(source, 'Run tests with coverage'), /flutter test --coverage --test-randomize-ordering-seed random/);
    assert.match(step(source, 'Run code generation (if needed)'), /flutter pub run build_runner build --delete-conflicting-outputs/);
    assert.match(step(source, 'Display coverage summary'), /coverage\/lcov.info/);
    assert.ok(step(source, 'Upload coverage artifact').includes(`name: flutter-coverage${name === 'analyze' ? '' : '-${{ matrix.dir }}'}`));
  }
  assert.match(step(job('analyze'), 'Verify dependencies'), /flutter pub get --enforce-lockfile/);
  assert.match(step(job('analyze-providers'), 'Apply monorepo pubspec overrides'), /cp pubspec_overrides.yaml.example pubspec_overrides.yaml\n.*cp example\/pubspec_overrides.yaml.example example\/pubspec_overrides.yaml/);
  for (const name of ['dependency-check', 'dependency-check-providers']) {
    const owasp = step(job(name), 'Run OWASP Dependency Check');
    for (const arg of ['--nvdApiKey ${{ secrets.NVD_API_KEY }}', '--enableExperimental', '--disableAssembly', '--disableRubygems', '--disableBundleAudit', '--disableNodeJS', '--disableNodeAudit', '--disablePyPkg', '--disablePyDist']) assert.ok(owasp.includes(arg), `${name}: ${arg}`);
    assert.match(step(job(name), 'Upload Dependency Check report'), /path: reports\//);
  }
});
