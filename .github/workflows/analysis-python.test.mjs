import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { failedRequiredJobs, splitJobList } from '../actions/verify-required-jobs/verify-required-jobs.mjs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./analysis-python.yml', import.meta.url), 'utf8');
const properties = readFileSync(
  new URL('../../Toggly.FeatureManagement.Python/sonar-project.properties', import.meta.url),
  'utf8',
);

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

test('Python Sonar test inclusions stay path-scoped so main sources are not classified as tests', () => {
  const sonar = job('sonar');
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.test\.inclusions=\*\*\/tests\/\*\*/);
    assert.doesNotMatch(scan, /-Dsonar\.test\.inclusions=\*\*\/\*\.py/);
  }

  assert.match(properties, /^sonar\.test\.inclusions=\*\*\/tests\/\*\*$/m);
  assert.doesNotMatch(properties, /^sonar\.test\.inclusions=\*\*\/\*\.py$/m);
});

const requiredJobs = ['contract', 'lint', 'type-check', 'test-core', 'test-django', 'test-flask', 'test-fastapi', 'test-cache', 'test-packed-host', 'integration', 'smoke-test', 'build', 'dependency-check', 'sonar'];
const verifierPath = fileURLToPath(new URL('../actions/verify-required-jobs/verify-required-jobs.mjs', import.meta.url));

function successfulNeeds() {
  return Object.fromEntries(requiredJobs.map(name => [name, { result: 'success' }]));
}

function expression(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}: \\$\\{\\{ (.*) \\}\\}$`, 'm'));
  assert.ok(match, `missing ${key} expression`);
  return match[1];
}

// Evaluate the actual boolean Actions expression subset. Hyphenated properties
// need JS bracket access; absent inputs differ from an explicit boolean false.
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

function verify(needs, required, allowed) {
  return spawnSync(process.execPath, [verifierPath], {
    env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), REQUIRED_JOBS: required.join(','), ALLOW_SKIPPED: allowed.join(',') },
    encoding: 'utf8',
  });
}

test('Python validators fail on each missing credential without exposing synthetic values', () => {
  for (const [name, keys] of [
    ['Validate SonarCloud credentials', ['SONAR_TOKEN']],
    ['Validate SonarQube Server credentials', ['SONAR_SERVER_TOKEN', 'SONAR_HOST_URL']],
  ]) {
    const validator = step(job('sonar'), name);
    assert.doesNotMatch(validator, /continue-on-error/);
    for (const key of keys) assert.match(validator, new RegExp(`secrets\\.${key}`));
    for (const missing of [null, ...keys, 'all']) {
      const env = Object.fromEntries(keys.map(key => [key, key === missing || missing === 'all' ? '' : 'synthetic-private-value']));
      const execution = spawnSync('bash', ['-e', '-c', runScript(validator)], { env, encoding: 'utf8' });
      assert.equal(execution.status, missing ? 1 : 0, `${name}: ${missing ?? 'all present'}`);
      assert.doesNotMatch(execution.stdout + execution.stderr, /synthetic-private-value/);
    }
  }
});

test('both Python scans wait for gates and preserve fatal scanner or gate failures', () => {
  const sonar = job('sonar');
  assert.doesNotMatch(sonar.split('    steps:')[0], /continue-on-error/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
    assert.match(scan, /-Dsonar\.projectKey=toggly-sdks-python/);
  }
});

test('Server diagnostics run after Cloud failure only with valid credentials and no cancellation', () => {
  const sonar = job('sonar');
  const validator = step(sonar, 'Validate SonarQube Server credentials');
  assert.match(validator, /id: validate-sonarqube-server-credentials/);
  for (const [previous, valid, cancelled, want] of [
    ['success', true, false, true], ['failure', true, false, true],
    ['success', false, false, false], ['failure', false, false, false],
    ['cancelled', true, true, false], ['cancelled', false, true, false],
    ['failure', true, true, false],
  ]) {
    const context = {
      success: () => previous === 'success', failure: () => previous === 'failure', cancelled: () => cancelled,
      steps: { 'validate-sonarqube-server-credentials': { outcome: valid ? 'success' : 'failure' } },
    };
    for (const name of ['Validate SonarQube Server credentials', 'Download Dependency Check report (for SonarQube Server)']) {
      assert.equal(evaluate(expression(step(sonar, name), 'if'), context), !cancelled, name);
    }
    assert.equal(evaluate(expression(step(sonar, 'SonarQube Server Scan'), 'if'), context), want);
  }
});

test('trusted reporting defaults on while only boolean false and fork PRs permit credentialed skips', () => {
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
    const context = { inputs: { run_reporting: input }, github: {
      event_name: eventName,
      event: eventName === 'pull_request' ? { pull_request: { head: { repo: { fork } } } } : {},
    } };
    for (const name of ['sonar', 'dependency-check']) {
      assert.equal(evaluate(expression(job(name), 'if'), context), runs, `${name}: ${eventName}/${fork}/${input}`);
    }
    assert.equal(evaluate(expression(job('summary'), 'allow-skipped'), context), allowed);
  }
});

test('actual summary verifier rejects every failed, cancelled, missing or unexpectedly skipped dependency', () => {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  assert.deepEqual(required, requiredJobs);
  const dependencies = summary.match(/needs: \[([^\]]+)\]/)[1].split(',').map(name => name.trim());
  assert.deepEqual(new Set(dependencies), new Set(requiredJobs));
  const allowed = splitJobList(evaluate(expression(summary, 'allow-skipped')));
  for (const name of requiredJobs) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
      const needs = successfulNeeds();
      if (result === undefined) delete needs[name];
      else needs[name].result = result;
      assert.deepEqual(failedRequiredJobs(needs, required, allowed), result === 'success' ? [] : [name]);
      const execution = verify(needs, required, allowed);
      assert.equal(execution.status, result === 'success' ? 0 : 1, `${name}: ${result}`);
      if (result !== 'success') assert.ok(execution.stderr.includes(`${name}: ${result ?? 'missing'}`));
    }
  }
});

test('intentional reporting skips cannot hide failed reporting or missing runtime and host checks', () => {
  const summary = job('summary');
  const required = splitJobList(summary.match(/required-jobs: (.+)/)[1]);
  for (const context of [
    { inputs: { run_reporting: false } },
    { github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: true } } } } } },
  ]) {
    const allowed = splitJobList(evaluate(expression(summary, 'allow-skipped'), context));
    const skipped = successfulNeeds();
    skipped.sonar.result = 'skipped';
    skipped['dependency-check'].result = 'skipped';
    assert.equal(verify(skipped, required, allowed).status, 0);
    for (const name of requiredJobs) {
      for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
        const needs = structuredClone(skipped);
        if (result === undefined) delete needs[name];
        else needs[name].result = result;
        const tolerated = ['sonar', 'dependency-check'].includes(name) && result === 'skipped';
        assert.deepEqual(failedRequiredJobs(needs, required, allowed), tolerated ? [] : [name]);
        assert.equal(verify(needs, required, allowed).status, tolerated ? 0 : 1, `${name}: ${result}`);
      }
    }
  }
});

test('summary emits real dependency results after failure and discloses absent authenticated proof', () => {
  const report = step(job('summary'), 'Generate summary');
  assert.equal(evaluate(expression(report, 'if'), { success: () => false, failure: () => true }), true);
  const directory = mkdtempSync(join(tmpdir(), 'python-summary-'));
  try {
    for (const [fork, input, result, want] of [
      [true, '', 'skipped', /Credentialed SonarCloud and SonarQube Server scans were skipped for this fork PR/],
      [false, false, 'skipped', /Reporting was explicitly disabled/],
      [false, '', 'failure', /Sonar: failure/],
      [false, '', 'cancelled', /Sonar: cancelled/],
      [false, '', 'success', /Sonar: success/],
    ]) {
      const context = {
        inputs: { run_reporting: input },
        github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork } } } } },
        needs: { ...successfulNeeds(), sonar: { result }, 'dependency-check': { result: fork || input === false ? 'skipped' : 'success' } },
      };
      const env = Object.fromEntries(['CONTRACT_RESULT', 'LINT_RESULT', 'TYPE_CHECK_RESULT', 'CORE_RESULT', 'DJANGO_RESULT', 'FLASK_RESULT', 'FASTAPI_RESULT', 'CACHE_RESULT', 'PACKED_HOST_RESULT', 'INTEGRATION_RESULT', 'SMOKE_RESULT', 'BUILD_RESULT', 'DEPENDENCY_CHECK_RESULT', 'SONAR_RESULT', 'FORK_PR', 'RUN_REPORTING']
        .map(key => [key, String(evaluate(expression(report, key), context))]));
      const path = join(directory, 'summary with spaces.md');
      const execution = spawnSync('bash', ['-e', '-c', runScript(report)], { env: { GITHUB_STEP_SUMMARY: path, ...env }, encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      const output = readFileSync(path, 'utf8');
      assert.match(output, want);
      for (const label of ['Workflow contract', 'Lint', 'Type check', 'Core tests', 'Django tests', 'Flask tests', 'FastAPI tests', 'Cache tests', 'Packed host', 'Integration', 'Smoke test', 'Build']) assert.ok(output.includes(`${label}: success`));
      assert.ok(output.includes(`OWASP: ${fork || input === false ? 'skipped' : 'success'}`));
      if (fork || input === false) assert.match(output, /authenticated Sonar gates were not checked/);
      assert.doesNotMatch(output, /✅|authenticated gates passed|workflow completed/i);
      rmSync(path);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('summary keeps every failed dependency visible alongside successful jobs', () => {
  const report = step(job('summary'), 'Generate summary');
  const outcomes = [
    ['contract', 'CONTRACT_RESULT', 'Workflow contract'], ['lint', 'LINT_RESULT', 'Lint'],
    ['type-check', 'TYPE_CHECK_RESULT', 'Type check'], ['test-core', 'CORE_RESULT', 'Core tests'],
    ['test-django', 'DJANGO_RESULT', 'Django tests'], ['test-flask', 'FLASK_RESULT', 'Flask tests'],
    ['test-fastapi', 'FASTAPI_RESULT', 'FastAPI tests'], ['test-cache', 'CACHE_RESULT', 'Cache tests'],
    ['test-packed-host', 'PACKED_HOST_RESULT', 'Packed host'], ['integration', 'INTEGRATION_RESULT', 'Integration'],
    ['smoke-test', 'SMOKE_RESULT', 'Smoke test'], ['build', 'BUILD_RESULT', 'Build'],
    ['sonar', 'SONAR_RESULT', 'Sonar'], ['dependency-check', 'DEPENDENCY_CHECK_RESULT', 'OWASP'],
  ];
  const directory = mkdtempSync(join(tmpdir(), 'python-failed-summary-'));
  try {
    for (const [failed] of outcomes) {
      const needs = successfulNeeds();
      needs[failed].result = 'failure';
      const env = Object.fromEntries(outcomes.map(([, key]) => [key, evaluate(expression(report, key), { needs })]));
      const path = join(directory, 'summary.md');
      const execution = spawnSync('bash', ['-e', '-c', runScript(report)], {
        env: { GITHUB_STEP_SUMMARY: path, RUN_REPORTING: '""', FORK_PR: 'false', ...env }, encoding: 'utf8',
      });
      assert.equal(execution.status, 0, execution.stderr);
      const output = readFileSync(path, 'utf8');
      for (const [name, , label] of outcomes) assert.ok(output.includes(`${label}: ${name === failed ? 'failure' : 'success'}`));
      rmSync(path);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('contract executes in its existing job and tracks workflow and shared gate dependencies', () => {
  assert.match(job('contract'), /run: node --test \.github\/workflows\/analysis-python\.test\.mjs/);
  for (const path of ['.github/workflows/analysis-python.yml', '.github/workflows/analysis-python.test.mjs', '.github/actions/verify-required-jobs/**', '.github/actions/sonar-project-version/**']) assert.ok(workflow.split('permissions:')[0].includes(`'${path}'`));
});

test('preserves Python package matrices, host checks, coverage XML and precise Sonar classification', () => {
  for (const name of ['test-core', 'test-flask', 'test-cache']) assert.match(job(name), /python-version: \["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14"\]/);
  assert.match(job('test-fastapi'), /python-version: \["3.9", "3.10", "3.11", "3.12", "3.13", "3.14"\]/);
  assert.match(job('test-django'), /django-version: \["4.2.\*", "5.0.\*", "5.1.\*"\]/);
  for (const version of ['5.2.17', '6.0.8', '6.1.1']) {
    assert.ok(job('test-django').includes(`django-version: "${version}"`));
    assert.ok(job('test-packed-host').includes(`django-version: "${version}"`));
  }
  const packages = [['core', 'toggly', 'toggly'], ['django', 'toggly-django', 'toggly_django'], ['flask', 'toggly-flask', 'toggly_flask'], ['fastapi', 'toggly-fastapi', 'toggly_fastapi'], ['cache', 'toggly-cache', 'toggly_cache']];
  for (const [name, directory, module] of packages) {
    const tests = job(`test-${name}`);
    assert.ok(step(tests, 'Run tests').includes(`--cov=src/${module} --cov-report=xml --cov-report=term-missing --cov-fail-under=80.01`));
    assert.ok(tests.includes(`name: python-coverage-${name}`));
    assert.ok(tests.includes(`path: \${{ env.SDK_ROOT }}/${directory}/coverage.xml`));
    assert.ok(job('build').includes(`cd ${directory}\n          python -m build\n          twine check dist/*`));
  }
  assert.match(job('test-packed-host'), /python tests\/host-fixtures\/verify_packed_host\.py/);
  assert.match(job('test-packed-host'), /frameworks: "all"/);
  assert.match(job('lint'), /ruff format --check tests\/host-fixtures/);
  assert.match(job('type-check'), /mypy toggly-cache\/src --ignore-missing-imports/);
  assert.match(job('smoke-test'), /pytest tests\/test_smoke\.py -v/);
  assert.match(job('integration'), /pip install -e toggly-fastapi\//);
  const sonar = job('sonar');
  assert.match(step(sonar, 'Download all coverage reports'), /pattern: python-coverage-\*/);
  const organize = step(sonar, 'Organize coverage files');
  assert.match(organize, /for pkg in core django flask fastapi cache/);
  assert.match(organize, /cp "coverage-artifacts\/python-coverage-\$pkg\/coverage\.xml" "coverage\/\$pkg-coverage\.xml"/);
  assert.match(step(sonar, 'Resolve Sonar project version'), /manifest: Toggly.FeatureManagement.Python\/toggly\/pyproject.toml/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    for (const arg of [
      '-Dsonar.projectVersion=${{ steps.sonar_version.outputs.version }}',
      '-Dsonar.sources=${{ env.SDK_ROOT }}/toggly/src,${{ env.SDK_ROOT }}/toggly-django/src,${{ env.SDK_ROOT }}/toggly-flask/src,${{ env.SDK_ROOT }}/toggly-fastapi/src,${{ env.SDK_ROOT }}/toggly-cache/src',
      '-Dsonar.tests=${{ env.SDK_ROOT }}/toggly/tests,${{ env.SDK_ROOT }}/toggly-django/tests,${{ env.SDK_ROOT }}/toggly-flask/tests,${{ env.SDK_ROOT }}/toggly-fastapi/tests,${{ env.SDK_ROOT }}/toggly-cache/tests,${{ env.SDK_ROOT }}/tests/host-fixtures',
      '-Dsonar.coverage.exclusions=**/telemetry/pb/**', '-Dsonar.cpd.exclusions=**/tests/**,**/telemetry/pb/**',
      '-Dsonar.python.coverage.reportPaths=coverage/*-coverage.xml',
    ]) assert.ok(scan.includes(arg), `${name}: ${arg}`);
    assert.match(scan, /-Dsonar.exclusions=.*\*\*\/tests\/\*\*.*\*\*\/telemetry\/pb\/\*\*/);
  }
  assert.match(step(sonar, 'SonarCloud Scan'), /-Dsonar.organization=ops-ai/);
  assert.match(step(sonar, 'SonarQube Server Scan'), /-Dsonar.dependencyCheck.reportPath=dependency-check-reports\/dependency-check-report.xml/);
  const owasp = step(job('dependency-check'), 'Run OWASP Dependency Check');
  for (const arg of ['--nvdApiKey ${{ secrets.NVD_API_KEY }}', '--enableExperimental', '--disableAssembly', '--disableRubygems', '--disableBundleAudit', '--disableNodeJS', '--disableNodeAudit']) assert.ok(owasp.includes(arg));
});
