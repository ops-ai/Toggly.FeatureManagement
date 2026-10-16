import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { failedRequiredJobs, splitJobList } from '../actions/verify-required-jobs/verify-required-jobs.mjs';

const workflow = readFileSync(new URL('./analysis-android.yml', import.meta.url), 'utf8');
const verifierPath = fileURLToPath(new URL('../actions/verify-required-jobs/verify-required-jobs.mjs', import.meta.url));
const requiredJobs = ['build-and-test', 'lint', 'code-coverage', 'build-samples', 'api-compatibility', 'smoke-test', 'dependency-check', 'sonar'];

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

test('Android validators reject each missing credential without revealing values', () => {
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

test('both Android scans wait for gates and propagate scan or gate errors', () => {
  const sonar = job('sonar');
  assert.doesNotMatch(sonar.split('    steps:')[0], /continue-on-error/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
    assert.match(scan, /-Dsonar\.projectKey=toggly-sdks-android/);
  }
});

test('Server diagnoses Cloud failures only with valid credentials and stops on cancellation', () => {
  const sonar = job('sonar');
  const validator = step(sonar, 'Validate SonarQube Server credentials');
  const scan = step(sonar, 'SonarQube Server Scan');
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
  assert.deepEqual(failedRequiredJobs(needs, required, allow), ['dependency-check', 'sonar']);
});

test('intentional reporting skips still reject failed reporting and missing required Android jobs', () => {
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
      ['build-and-test', undefined, ['build-and-test']], ['build-and-test', 'skipped', ['build-and-test']],
      ['code-coverage', undefined, ['code-coverage']], ['build-samples', 'skipped', ['build-samples']],
      ['lint', 'skipped', ['lint']], ['api-compatibility', 'skipped', ['api-compatibility']], ['smoke-test', 'skipped', ['smoke-test']],
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
  const directory = mkdtempSync(join(tmpdir(), 'android-summary-'));
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
      const env = Object.fromEntries(['FORK_PR', 'RUN_REPORTING', 'BUILD_RESULT', 'LINT_RESULT', 'COVERAGE_RESULT', 'SAMPLES_RESULT', 'API_RESULT', 'SMOKE_RESULT', 'SONAR_RESULT', 'DEPENDENCY_CHECK_RESULT']
        .map(key => [key, String(evaluate(expression(report, key), context))]));
      const result = spawnSync('bash', ['-e', '-c', runScript(report)], {
        env: { GITHUB_STEP_SUMMARY: path, ...env }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const output = readFileSync(path, 'utf8');
      assert.match(output, want);
      assert.match(output, /Build and tests: success/);
      for (const label of ['Lint', 'Coverage', 'Samples', 'API compatibility', 'Smoke test']) assert.ok(output.includes(`${label}: success`));
      assert.match(output, /OWASP: success/);
      if (fork || input === false) assert.match(output, /authenticated Sonar gates were not checked/);
      assert.doesNotMatch(output, /✅|authenticated gates passed/i);
      rmSync(path);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Android contract checks execute in the existing lint job and trigger on changes', () => {
  const lint = job('lint');
  assert.match(step(lint, 'Setup Node.js for workflow contract tests'), /uses: actions\/setup-node@v7\n\s+with:\n\s+node-version: '20.x'/);
  assert.match(step(lint, 'Verify Android analysis workflow contract'), /run: node --test \.github\/workflows\/analysis-android\.test\.mjs/);
  assert.match(workflow.split('permissions:')[0], /'\.github\/workflows\/analysis-android\.test\.mjs'/);
});

test('cancellation blocks Server diagnostics even if an earlier step failed', () => {
  const context = {
    success: () => false, failure: () => true, cancelled: () => true,
    steps: { 'validate-sonarqube-server-credentials': { outcome: 'success' } },
  };
  for (const name of ['Validate SonarQube Server credentials', 'SonarQube Server Scan']) {
    assert.equal(evaluate(expression(step(job('sonar'), name), 'if'), context), false, name);
  }
});

test('preserves Android Java matrix, Gradle checks, native telemetry coverage and scanner configuration', () => {
  assert.match(job('build-and-test'), /java: \['17', '21'\]/);
  for (const [jobName, stepName, command] of [
    ['build-and-test', 'Build all modules', './gradlew build -x test'],
    ['build-and-test', 'Run unit tests', './gradlew test'],
    ['lint', 'Run Android Lint', './gradlew lint'],
    ['build-samples', 'Build release artifacts', './gradlew assembleRelease'],
    ['smoke-test', 'Compile smoke tests', './gradlew :toggly-android-core:compileDebugUnitTestKotlin'],
    ['smoke-test', 'Run smoke test', './gradlew :toggly-android-core:testDebugUnitTest --tests "io.toggly.core.SmokeTest"'],
  ]) assert.ok(step(job(jobName), stepName).includes(`run: ${command}`));
  assert.match(step(job('api-compatibility'), 'Check API compatibility'), /\.\/gradlew apiCheck/);
  const coverage = job('code-coverage');
  assert.match(coverage, /runs-on: macos-15-intel/);
  assert.match(step(coverage, 'Run tests with coverage'), /\.\/gradlew testDebugUnitTest koverXmlReport/);
  const collector = step(coverage, 'Test the public acceptance collector with coverage');
  for (const command of ['coverage==7.10.7', '--source=tool -m unittest discover', "--omit='tool/test_*.py' --fail-under=80", "--omit='tool/test_*.py' -o coverage.xml"]) assert.ok(collector.includes(command));
  const native = step(coverage, 'Measure public acceptance Activity coverage on Android API 35');
  assert.match(native, /api-level: 35/);
  assert.match(native, /script: bash tool\/run_android_coverage.sh/);
  const artifact = step(coverage, 'Upload coverage artifact');
  for (const path of ['name: android-coverage', '**/build/reports/kover/report.xml', 'app/build/reports/coverage/androidTest/debug/connected/report.xml', 'app/build/reports/androidTests/connected/device-diagnostics.txt', 'acceptance/public-telemetry-host/coverage.xml']) assert.ok(artifact.includes(path));
  const sonar = job('sonar');
  assert.match(step(sonar, 'Resolve Sonar project version'), /manifest: Toggly.FeatureManagement.Android\/build.gradle.kts/);
  assert.match(step(sonar, 'Rebase Python coverage paths for Sonar'), /roots\[0\]\.text = str\(source\)/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    for (const arg of [
      '-Dsonar.projectVersion=${{ steps.sonar_version.outputs.version }}', '-Dsonar.sources=${{ env.SDK_ROOT }}',
      '-Dsonar.exclusions=**/build/**,**/test/**,**/androidTest/**,**/*.bak',
      '-Dsonar.test.inclusions=**/src/test/**,**/src/androidTest/**,**/tool/test_*.py',
      '-Dsonar.coverage.jacoco.xmlReportPaths=coverage-artifacts/**/build/reports/kover/report.xml,coverage-artifacts/**/build/reports/coverage/androidTest/debug/connected/report.xml',
      '-Dsonar.python.coverage.reportPaths=coverage-artifacts/**/coverage.xml',
    ]) assert.ok(scan.includes(arg), `${name}: ${arg}`);
  }
  assert.match(step(sonar, 'SonarQube Server Scan'), /-Dsonar.dependencyCheck.reportPath=dependency-check-reports\/dependency-check-report.xml/);
  const owasp = step(job('dependency-check'), 'Run OWASP Dependency Check');
  for (const arg of ['--disableAssembly', '--disableRubygems', '--disableBundleAudit', '--disableNodeJS', '--disableNodeAudit', '--disablePyPkg', '--disablePyDist']) assert.ok(owasp.includes(arg));
});
