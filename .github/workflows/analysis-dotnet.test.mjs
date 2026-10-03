import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./analysis-dotnet.yml', import.meta.url), 'utf8');

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing ${name} step`);
  const end = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}

function runScript(name) {
  const lines = step(name).split('\n');
  const start = lines.indexOf('        run: |');
  assert.notEqual(start, -1, `missing ${name} run script`);
  return lines.slice(start + 1)
    .filter(line => line === '' || line.startsWith('          '))
    .map(line => line.slice(10))
    .join('\n')
    .replaceAll(/\$\{\{[^}]+\}\}/g, 'fixture');
}

function scan(overrides = {}, withCredentialGuard = false) {
  const directory = mkdtempSync(join(tmpdir(), 'dotnet-sonar-gate-'));
  const log = join(directory, 'scan.log');
  writeFileSync(log, '');
  writeFileSync(join(directory, 'dotnet'), `#!/usr/bin/env bash
printf 'CALL\\n' >> "$SCAN_LOG"
printf '%s\\n' "$@" >> "$SCAN_LOG"
if [[ "$SCAN_FAIL" = 1 ]]; then exit 42; fi
`, { mode: 0o755 });
  writeFileSync(join(directory, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  try {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', (withCredentialGuard ? `${runScript('Validate Sonar credentials')}\n${runScript('Begin SonarCloud Scan')}\n` : '') + runScript('Begin SonarQube Server Scan')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        SCAN_LOG: log,
        GITHUB_EVENT_NAME: 'pull_request',
        PR_NUMBER: '702',
        PR_SOURCE_BRANCH: 'catalog-updates',
        PR_BASE_BRANCH: 'develop',
        PR_HEAD_SHA: 'example-pr-head',
        SONAR_TOKEN: 'cloud-test-token',
        SONAR_SERVER_TOKEN: 'test-token',
        SONAR_HOST_URL: 'https://sonar.example.test',
        GITHUB_WORKSPACE: '/tmp/sdk-fixture',
        ...overrides,
      },
    });
    const calls = readFileSync(log, 'utf8').split('CALL\n').filter(Boolean).map(value => value.trim().split('\n'));
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('analyze checks out the PR head and supplies each PR field to Server begin', () => {
  const checkout = step('Checkout code');
  assert.match(checkout, /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);

  const begin = step('Begin SonarQube Server Scan');
  for (const [variable, expression] of [
    ['PR_NUMBER', 'github.event.pull_request.number'],
    ['PR_SOURCE_BRANCH', 'github.event.pull_request.head.ref'],
    ['PR_BASE_BRANCH', 'github.event.pull_request.base.ref'],
    ['PR_HEAD_SHA', 'github.event.pull_request.head.sha'],
  ]) {
    assert.ok(begin.includes(`${variable}: \${{ ${expression} }}`), `${variable} must come from PR metadata`);
  }

  const { result, calls } = scan();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 1);
  for (const argument of [
    '/d:sonar.pullrequest.key=702',
    '/d:sonar.pullrequest.branch=catalog-updates',
    '/d:sonar.pullrequest.base=develop',
    '/d:sonar.scm.revision=example-pr-head',
    '/d:sonar.qualitygate.wait=true',
  ]) {
    assert.ok(calls[0].includes(argument), `missing scanner argument: ${argument}`);
  }
});

test('missing PR metadata fails before starting a Server scan', () => {
  for (const field of ['PR_NUMBER', 'PR_SOURCE_BRANCH', 'PR_BASE_BRANCH', 'PR_HEAD_SHA']) {
    const { result, calls } = scan({ [field]: '' });
    assert.notEqual(result.status, 0, `${field} was accepted`);
    assert.equal(calls.length, 0, `${field} started a scan`);
  }
});

test('dispatch and call analyses wait for their branch gate without empty PR properties', () => {
  for (const eventName of ['workflow_dispatch', 'workflow_call']) {
    const { result, calls } = scan({ GITHUB_EVENT_NAME: eventName, PR_NUMBER: '', PR_SOURCE_BRANCH: '', PR_BASE_BRANCH: '', PR_HEAD_SHA: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('/d:sonar.qualitygate.wait=true'));
    assert.ok(calls[0].every(argument => !argument.startsWith('/d:sonar.pullrequest.') && !argument.startsWith('/d:sonar.scm.revision=')));
  }
});

test('repeated Server scanner failure fails the job', () => {
  const { result, calls } = scan({ SCAN_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(calls.length, 3);
  const end = step('End SonarQube Server Scan');
  assert.match(end, /run: dotnet sonarscanner end /);
  assert.doesNotMatch(end, /continue-on-error: true|\|\| true/);
});

test('.NET analysis scans and covers the CLI executable', () => {
  const sourceInclusion = /sonar\.inclusions=.*Toggly\.CLI\/\*\*/g;

  assert.equal([...workflow.matchAll(sourceInclusion)].length, 2);
  assert.match(
    workflow,
    /dotnet test Toggly\.CLI\.Tests\/Toggly\.CLI\.Tests\.csproj[\s\S]*--collect:"XPlat Code Coverage"/,
  );
  assert.match(
    workflow,
    /Build every additional \.NET family inside the server scanner[\s\S]*dotnet build Toggly\.CLI\.Tests\/Toggly\.CLI\.Tests\.csproj -c Release/,
  );
  assert.match(
    workflow,
    /name: Verify \.NET analysis workflow contract\s+run: node --test \.github\/workflows\/analysis-dotnet\.test\.mjs/,
  );
});

test('both scanners and summary use one validated common package version', () => {
  const versionStep = step('Read common .NET package version');
  assert.match(versionStep, /id: analysis_version/);
  assert.equal(workflow.split('- name: Read common .NET package version').length - 1, 1);
  assert.doesNotMatch(workflow, /gittools\/actions\/gitversion|steps\.gitversion/);
  const directory = mkdtempSync(join(tmpdir(), 'dotnet-analysis-output-'));
  try {
    const output = join(directory, 'output');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', runScript('Read common .NET package version')], {
      encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, 'utf8'), /^version=\d+\.\d+\.\d+\n$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const name of ['Begin SonarCloud Scan', 'Begin SonarQube Server Scan']) {
    assert.match(step(name), /\/v:"\$\{\{ steps\.analysis_version\.outputs\.version \}\}"/);
  }
  assert.match(step('Test Summary'), /Version:\*\* \$\{\{ steps\.analysis_version\.outputs\.version \}\}/);
});

test('credential preflight fails without leaking values or starting either scanner', () => {
  const guard = step('Validate Sonar credentials');
  assert.doesNotMatch(guard, /if:|continue-on-error:/);
  assert.ok(workflow.indexOf('- name: Validate Sonar credentials') < workflow.indexOf('- name: Begin SonarCloud Scan'));
  for (const field of ['SONAR_TOKEN', 'SONAR_SERVER_TOKEN', 'SONAR_HOST_URL']) {
    assert.ok(guard.includes(`${field}: \${{ secrets.${field} }}`));
    const { result, calls } = scan({ [field]: '' }, true);
    assert.notEqual(result.status, 0, `${field} was accepted`);
    assert.equal(calls.length, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), field);
  }
  const { result, calls } = scan({ GITHUB_EVENT_NAME: 'workflow_call' }, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 2);
  assert.equal(result.stdout, '');
});

test('core test failures prevent scanner uploads and Server analysis', () => {
  const core = step('Run core tests');
  assert.doesNotMatch(core, /continue-on-error:|if:|\|\| true/);
  for (const name of ['End SonarCloud Scan', 'Begin SonarQube Server Scan', 'End SonarQube Server Scan']) {
    assert.ok(workflow.indexOf(`- name: ${name}`) > workflow.indexOf('- name: Run core tests'));
    assert.doesNotMatch(step(name), /continue-on-error:|if: always\(\)|\|\| true/);
  }
});

test('reporting false skips only dependency reporting and allows that exact summary skip', () => {
  const analyze = workflow.slice(workflow.indexOf('  analyze:'), workflow.indexOf('  dependency-check:'));
  assert.doesNotMatch(analyze, /if:.*run_reporting/);
  const dependency = workflow.slice(workflow.indexOf('  dependency-check:'), workflow.indexOf('  build-cli:'));
  assert.match(dependency, /if: \$\{\{ toJSON\(inputs\.run_reporting\) != 'false' \}\}/);
  assert.match(workflow.slice(workflow.indexOf('  summary:')), /allow-skipped: \$\{\{ toJSON\(inputs\.run_reporting\) == 'false' && 'dependency-check' \|\| 'none' \}\}/);
  const { result, calls } = scan({ GITHUB_EVENT_NAME: 'workflow_call', SONAR_TOKEN: '' }, true);
  assert.notEqual(result.status, 0);
  assert.equal(calls.length, 0);
  assert.equal(result.stderr.trim(), 'SONAR_TOKEN');
});
