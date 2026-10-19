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

const workflow = readFileSync(new URL('./analysis-go.yml', import.meta.url), 'utf8');
const verifierPath = fileURLToPath(new URL('../actions/verify-required-jobs/verify-required-jobs.mjs', import.meta.url));
const requiredJobs = ['test', 'smoke-test', 'current-runtime', 'mongodb-v2', 'mongodb-v2-consumer', 'toggly-go-consumer', 'build', 'dependency-check', 'sonar', 'sonar-mongodb-v2'];
const reportingJobs = ['sonar', 'sonar-mongodb-v2', 'dependency-check'];
const outcomes = [
  ['test', 'TEST_RESULT', 'Tests and lint'], ['smoke-test', 'SMOKE_RESULT', 'Smoke test'],
  ['current-runtime', 'CURRENT_RUNTIME_RESULT', 'Go 1.27 current runtime'],
  ['mongodb-v2', 'MONGODB_V2_RESULT', 'MongoDB Driver v2 tests'],
  ['mongodb-v2-consumer', 'MONGODB_V2_CONSUMER_RESULT', 'Archived MongoDB Driver v2 consumer'],
  ['toggly-go-consumer', 'TOGGLY_GO_CONSUMER_RESULT', 'Archived core consumer'],
  ['build', 'BUILD_RESULT', 'Example build'], ['dependency-check', 'DEPENDENCY_CHECK_RESULT', 'OWASP'],
  ['sonar', 'SONAR_RESULT', 'Core Sonar'], ['sonar-mongodb-v2', 'MONGODB_V2_SONAR_RESULT', 'MongoDB Driver v2 Sonar'],
];

function job(name, source = workflow) {
  const start = source.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const next = source.slice(start + 1).search(/\n  [A-Za-z_][A-Za-z0-9_-]*:\n/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test('job slices stop at consecutive digit-bearing identifiers instead of borrowing adjacent checks', () => {
  const source = 'jobs:\n  mongodb-v2:\n    marker: adapter-tests\n  mongodb-v2-consumer:\n    marker: packed-consumer\n  sonar-mongodb-v2:\n    marker: fatal-gates\n';
  assert.equal(job('mongodb-v2', source), '\n  mongodb-v2:\n    marker: adapter-tests');
  assert.doesNotMatch(job('mongodb-v2', source), /packed-consumer|fatal-gates/);
  assert.equal(job('mongodb-v2-consumer', source), '\n  mongodb-v2-consumer:\n    marker: packed-consumer');
  assert.doesNotMatch(job('mongodb-v2-consumer', source), /fatal-gates/);
});

test('job boundaries support uppercase and underscore identifiers without matching nested properties', () => {
  for (const next of ['Build2', '_consumer2', 'consumer_v2']) {
    const source = `jobs:\n  target:\n    env:\n      NESTED_KEY2: keep-in-target\n    marker: target-check\n  ${next}:\n    marker: adjacent-check\n`;
    assert.equal(job('target', source), '\n  target:\n    env:\n      NESTED_KEY2: keep-in-target\n    marker: target-check');
    assert.doesNotMatch(job('target', source), /adjacent-check/);
    assert.equal(job(next, source), `\n  ${next}:\n    marker: adjacent-check\n`);
  }
});

test('final digit-bearing job retains its full body with or without a trailing newline', () => {
  for (const ending of ['', '\n']) {
    const source = `jobs:\n  first:\n    marker: preceding-check\n  final_v2:\n    marker: final-check${ending}`;
    assert.equal(job('final_v2', source), `\n  final_v2:\n    marker: final-check${ending}`);
    assert.doesNotMatch(job('final_v2', source), /preceding-check/);
  }
});

function step(source, name) {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const next = source.indexOf('\n      - name:', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function preservationSignature(source) {
  // Ignore only a uses ref; retain action identity and every other byte.
  const normalized = source.replace(/^([ \t]*uses:[ \t]+[^\s@]+)@[^\s#]+/gm, '$1@<ref>');
  return createHash('sha256').update(normalized).digest('hex');
}

test('preservation signatures tolerate version and SHA ref updates for the same actions', () => {
  for (const source of [
    step(job('sonar-mongodb-v2'), 'SonarCloud Scan - MongoDB Driver v2'),
    step(job('sonar-mongodb-v2'), 'SonarQube Server Scan - MongoDB Driver v2'),
    '        uses: example-owner/example-action/nested/path@v1\n        with:\n          argument: stable\n',
  ]) {
    for (const ref of ['v99.1.0', '0123456789abcdef0123456789abcdef01234567']) {
      const updated = source.replace(/^(\s*uses: [^\s@]+)@[^\s#]+/gm, `$1@${ref}`);
      assert.notEqual(updated, source, 'fixture must update an action ref');
      assert.equal(preservationSignature(updated), preservationSignature(source));
    }
  }
});

test('preservation signatures retain action owner repository and path identities', () => {
  const source = '        uses: example-owner/example-action/nested/path@v1\n        with:\n          argument: stable\n';
  for (const updated of [
    source.replace('example-owner/', 'other-owner/'),
    source.replace('/example-action/', '/other-action/'),
    source.replace('/nested/path@', '/different/path@'),
  ]) assert.notEqual(preservationSignature(updated), preservationSignature(source));
});

test('preservation signatures reject gate credential project coverage and baseline mutations', () => {
  const cloud = step(job('sonar-mongodb-v2'), 'SonarCloud Scan - MongoDB Driver v2');
  const server = step(job('sonar-mongodb-v2'), 'SonarQube Server Scan - MongoDB Driver v2');
  const mutations = [
    [cloud, 'sonar.qualitygate.wait=true', 'sonar.qualitygate.wait=false'],
    [server, 'sonar.qualitygate.wait=true', 'sonar.qualitygate.wait=false'],
    [cloud, 'secrets.SONAR_TOKEN', 'secrets.DIFFERENT_TOKEN'],
    [server, 'secrets.SONAR_SERVER_TOKEN', 'secrets.DIFFERENT_TOKEN'],
    [server, 'secrets.SONAR_HOST_URL', 'secrets.DIFFERENT_HOST_URL'],
    [cloud, 'SONAR_HOST_URL: https://sonarcloud.io', 'SONAR_HOST_URL: https://different.invalid'],
    [cloud, 'sonar.projectKey=toggly-sdks-go-mongodb-v2', 'sonar.projectKey=different-project'],
    [server, 'sonar.go.coverage.reportPaths=coverage.out', 'sonar.go.coverage.reportPaths=other.out'],
    [cloud, 'projectBaseDir: toggly-go-mongodb-v2', 'projectBaseDir: other-module'],
    [cloud, 'sonar.exclusions=**/*_test.go,**/examples/**', 'sonar.exclusions=**/*'],
    [cloud, 'sonar.test.inclusions=**/*_test.go', 'sonar.test.inclusions=**/*.go'],
    [cloud, 'sonar.projectVersion=${{ steps.sonar_version.outputs.version }}', 'sonar.projectVersion=fixed-version'],
    [cloud, 'SonarSource/sonarqube-scan-action', 'other-owner/sonarqube-scan-action'],
    [server, 'SonarSource/sonarqube-scan-action', 'SonarSource/other-action'],
    [cloud, 'sonar.branch.name=master', 'sonar.branch.name=develop'],
    [cloud, 'sonar.scm.revision={0}', 'sonar.scm.revision=deadbeef'],
    [cloud, "github.event_name != 'pull_request'", "github.event_name == 'pull_request'"],
    [server, 'sonar.branch.name=master', 'sonar.branch.name=main'],
    [server, 'sonar.scm.revision={0}', 'sonar.scm.revision=deadbeef'],
    [server, "github.event_name != 'pull_request'", "github.event_name == 'pull_request'"],
  ];
  for (const [source, before, after] of mutations) {
    const updated = source.replace(before, after);
    assert.notEqual(updated, source, `mutation target must exist: ${before}`);
    assert.notEqual(preservationSignature(updated), preservationSignature(source), before);
  }
});

function expression(source, key) {
  const match = source.match(new RegExp(`^\\s*${key}: \\$\\{\\{ (.*) \\}\\}$`, 'm'));
  assert.ok(match, `missing ${key} expression`);
  return match[1];
}

// Execute the workflow's boolean expression subset with explicit event and
// status inputs. Absent reporting inputs differ from boolean false.
function evaluate(source, context = {}) {
  return runInNewContext(source.replace(/\.([a-zA-Z_][\w]*-[\w-]+)/g, '["$1"]'), {
    inputs: { run_reporting: '' },
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
  const directory = mkdtempSync(join(tmpdir(), 'go-summary-'));
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

test('core validators reject every missing credential without disclosing synthetic values', () => {
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

test('both core scanners wait for fatal quality gates with authored coverage classification', () => {
  const sonar = job('sonar');
  assert.doesNotMatch(sonar.split('    steps:')[0], /continue-on-error/);
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const scan = step(sonar, name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
    for (const arg of [
      'projectBaseDir: toggly-go', '-Dsonar.projectKey=toggly-sdks-go',
      '-Dsonar.projectVersion=${{ steps.sonar_version.outputs.version }}',
      '-Dsonar.sources=.', '-Dsonar.tests=.', '-Dsonar.test.inclusions=**/*_test.go',
      '-Dsonar.exclusions=**/*_test.go,**/vendor/**,**/examples/**,**/*.pb.go',
      '-Dsonar.go.coverage.reportPaths=coverage.out',
    ]) assert.ok(scan.includes(arg), `${name}: ${arg}`);
  }
  assert.match(step(sonar, 'SonarCloud Scan'), /-Dsonar.organization=ops-ai/);
  assert.match(step(sonar, 'SonarQube Server Scan'), /-Dsonar.dependencyCheck.reportPath=\.\.\/dependency-check-reports\/dependency-check-report.xml/);
  assert.match(step(sonar, 'Resolve Sonar project version'), /manifest: toggly-go\/VERSION/);
});

test('Server diagnostics survive Cloud failure only with successful validation and no cancellation', () => {
  const sonar = job('sonar');
  assert.match(step(sonar, 'Validate SonarQube Server credentials'), /id: validate-sonarqube-server-credentials/);
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
    for (const name of ['Validate SonarQube Server credentials', 'Download Dependency Check report (for SonarQube Server)']) {
      assert.equal(evaluate(expression(step(sonar, name), 'if'), context), !cancelled, name);
    }
    assert.equal(evaluate(expression(step(sonar, 'SonarQube Server Scan'), 'if'), context), want);
  }
});

test('trusted events default reporting on and share only explicit false or fork skip policy', () => {
  assert.doesNotMatch(workflow, /pull_request_target/);
  for (const [eventName, fork, input, runs, allowed] of [
    ['pull_request', false, '', true, 'none'], ['workflow_dispatch', false, '', true, 'none'],
    ['workflow_call', false, true, true, 'none'], ['workflow_call', false, '', true, 'none'],
    ['workflow_call', false, undefined, true, 'none'], ['workflow_call', false, 'false', true, 'none'],
    ['pull_request', true, '', false, 'sonar,sonar-mongodb-v2,dependency-check'],
    ['workflow_call', false, false, false, 'sonar,sonar-mongodb-v2,dependency-check'],
    ['workflow_dispatch', false, false, false, 'sonar,sonar-mongodb-v2,dependency-check'],
    ['workflow_dispatch', true, '', true, 'none'],
  ]) {
    const context = { inputs: { run_reporting: input }, github: {
      event_name: eventName,
      event: eventName === 'pull_request' ? { pull_request: { head: { repo: { fork } } } } : {},
    } };
    for (const name of reportingJobs) assert.equal(evaluate(expression(job(name), 'if'), context), runs, `${name}: ${eventName}/${fork}/${input}`);
    assert.equal(evaluate(expression(job('summary'), 'allow-skipped'), context), allowed);
  }
});

test('summary verifier requires all ten jobs and rejects failed cancelled missing and unexpected skips', () => {
  const requirements = summaryRequirements();
  const dependencies = job('summary').match(/needs: \[([^\]]+)\]/)[1].split(',').map(name => name.trim());
  assert.deepEqual(new Set(dependencies), new Set(requiredJobs));
  for (const name of requiredJobs) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
      const needs = successfulNeeds();
      if (result === undefined) delete needs[name];
      else needs[name].result = result;
      const execution = verify(needs, requirements);
      assert.equal(execution.status, result === 'success' ? 0 : 1, `${name}: ${result}`);
      if (result !== 'success') assert.ok(execution.stderr.includes(`${name}: ${result ?? 'missing'}`));
    }
  }
});

test('intentional reporting skips never tolerate failed cancelled missing or skipped runtime evidence', () => {
  for (const context of [
    { inputs: { run_reporting: false } },
    { github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork: true } } } } } },
  ]) {
    const requirements = summaryRequirements(context);
    const skipped = successfulNeeds();
    for (const name of reportingJobs) skipped[name].result = 'skipped';
    assert.equal(verify(skipped, requirements).status, 0);
    for (const name of requiredJobs) {
      for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
        const needs = structuredClone(skipped);
        if (result === undefined) delete needs[name];
        else needs[name].result = result;
        const tolerated = reportingJobs.includes(name) && result === 'skipped';
        assert.equal(verify(needs, requirements).status, tolerated ? 0 : 1, `${name}: ${result}`);
      }
    }
  }
});

test('summary runs after verification failure and emits every actual result without blanket success', () => {
  assert.equal(evaluate(expression(step(job('summary'), 'Generate summary'), 'if'), { success: () => false, failure: () => true }), true);
  for (const [changed] of outcomes) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = successfulNeeds();
      needs[changed].result = result;
      const output = generateSummary({ needs });
      for (const [name, , label] of outcomes) assert.ok(output.includes(`${label}: ${name === changed ? result : 'success'}`), `${name}: ${output}`);
      assert.doesNotMatch(output, /✅|workflow completed|checks passed|compatibility verified/i);
    }
  }
});

test('summary discloses absent authenticated Sonar and OWASP proof for every permitted skip', () => {
  for (const [fork, input, reason] of [[true, '', /skipped for this fork PR/], [false, false, /Reporting was explicitly disabled/]]) {
    const needs = successfulNeeds();
    for (const name of reportingJobs) needs[name].result = 'skipped';
    const output = generateSummary({
      needs, inputs: { run_reporting: input },
      github: { event_name: 'pull_request', event: { pull_request: { head: { repo: { fork } } } } },
    });
    assert.match(output, reason);
    assert.match(output, /authenticated Sonar gates were not checked/);
    assert.match(output, /OWASP reporting was also skipped/);
    for (const [name, , label] of outcomes) assert.ok(output.includes(`${label}: ${reportingJobs.includes(name) ? 'skipped' : 'success'}`));
  }
});

test('gate regressions execute in the existing normal test job and trigger their own PR checks', () => {
  assert.match(workflow.split('jobs:')[0], /paths:[\s\S]*'\.github\/workflows\/analysis-go.test.mjs'/);
  const contract = step(job('test'), 'Test workflow gate behavior');
  assert.match(contract, /working-directory: \./);
  assert.match(contract, /run: node --test \.github\/workflows\/analysis-go.test.mjs/);
  assert.match(step(job('test'), 'Setup Node for workflow tests'), /node-version: '24'/);
});

test('MongoDB v2 fatal scanners wait on main-branch analysis outside pull requests', () => {
  const hash = preservationSignature;
  assert.equal(hash(step(job('sonar-mongodb-v2'), 'SonarCloud Scan - MongoDB Driver v2')), '7e71bf4edc07ecdbb00601e13933a7220cd1f0bedaf3489ae5f7ec580f4c1f9d');
  assert.equal(hash(step(job('sonar-mongodb-v2'), 'SonarQube Server Scan - MongoDB Driver v2')), 'bc857e407e7aabb113fc2a21d197c0ab8869ef77d7e866fe712ed605ad5bfb8d');
  for (const name of ['SonarCloud Scan - MongoDB Driver v2', 'SonarQube Server Scan - MongoDB Driver v2']) {
    const scan = step(job('sonar-mongodb-v2'), name);
    assert.match(scan, /-Dsonar\.qualitygate\.wait=true/);
    assert.match(scan, /sonar\.branch\.name=master/);
    assert.match(scan, /sonar\.scm\.revision=\{0\}/);
    assert.match(scan, /github\.event_name != 'pull_request'/);
    assert.doesNotMatch(scan, /continue-on-error|\|\| true/);
  }
  assert.doesNotMatch(workflow, /mongodb-v2-sonar-main|bootstrap_mongodb_v2_main/);
});

test('existing runtime consumer coverage database example and OWASP contracts are retained', () => {
  const tests = job('test');
  for (const value of ['postgres:17-alpine', 'mongo:8', 'redis:7-alpine', 'POSTGRES_TEST_URL:', 'MONGO_TEST_URI:', 'REDIS_TEST_ADDR:']) assert.ok(tests.includes(value));
  assert.match(step(tests, 'Run all tests with raw coverage'), /go test -v -race -timeout 5m -coverprofile=coverage-raw.out -covermode=atomic \.\/\.\.\./);
  assert.ok(step(tests, 'Measure authored module coverage').includes("grep -vE '/examples/|/metricspb$|/usagepb$'"));
  assert.match(step(tests, 'Display coverage'), /if \(\$3 <= 80\) exit 1/);
  assert.match(step(tests, 'Upload coverage artifact'), /name: go-coverage/);
  assert.match(job('smoke-test'), /go test.*TestSmoke/);
  assert.match(job('current-runtime'), /go-version: '1.27.x'/);
  assert.match(job('mongodb-v2'), /go-version: \['1.25.x', '1.27.x'\]/);
  assert.match(job('mongodb-v2'), /go test -v -race/);
  assert.match(job('mongodb-v2'), /if \(\$3 <= 80\) exit 1/);
  for (const name of ['mongodb-v2-consumer', 'toggly-go-consumer']) {
    const consumer = job(name);
    assert.match(consumer, /git archive --format=tar HEAD:/);
    assert.match(consumer, /go get golang.org\/x\/crypto@latest golang.org\/x\/net@latest/);
    assert.match(consumer, /go build \.\/\.\.\./);
  }
  assert.match(job('build'), /for example in examples\/\*\.go/);
  const owasp = step(job('dependency-check'), 'Run OWASP Dependency Check');
  for (const arg of ['--nvdApiKey ${{ secrets.NVD_API_KEY }}', '--enableExperimental', '--disableAssembly', '--disableRubygems', '--disableBundleAudit', '--disableNodeJS', '--disableNodeAudit', '--disablePyPkg', '--disablePyDist']) assert.ok(owasp.includes(arg));
});
