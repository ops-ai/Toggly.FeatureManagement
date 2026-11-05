import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./analysis-ios.yml', import.meta.url), 'utf8');

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const next = workflow.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

test('iOS reporting jobs use toJSON(run_reporting) fail-open for string false', () => {
  const sonar = job('sonar');
  const dependencyCheck = job('dependency-check');
  const summary = job('summary');

  for (const reportingJob of [sonar, dependencyCheck]) {
    assert.match(reportingJob, /toJSON\(inputs\.run_reporting\) != 'false'/);
  }
  assert.match(
    summary,
    /allow-skipped: \$\{\{ toJSON\(inputs\.run_reporting\) == 'false' && 'sonar,dependency-check' \|\| 'none' \}\}/,
  );
});

test('iOS Sonar scans retain quality gates without scanner-wide issue exclusions', () => {
  const sonar = job('sonar');
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const start = sonar.indexOf(`      - name: ${name}\n`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = sonar.indexOf('\n      - name:', start + 1);
    const step = next === -1 ? sonar.slice(start) : sonar.slice(start, next);
    assert.doesNotMatch(step, /-Dsonar\.issue\.ignore\.multicriteria/);
    assert.match(step, /-Dsonar\.qualitygate\.wait=true/);
  }
});

test('iOS build-and-test keeps Xcode 16.1 floor and proves current 26.x / 27.x', () => {
  const build = job('build-and-test');
  assert.match(build, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.match(build, /os: macos-15[\s\S]*xcode: '16\.1'[\s\S]*consumer_ios: '14\.0'/);
  assert.match(build, /os: macos-15[\s\S]*xcode: '16\.2'[\s\S]*consumer_ios: '14\.0'/);
  assert.match(build, /os: macos-15[\s\S]*xcode: '16\.4'[\s\S]*consumer_ios: '14\.0'/);
  assert.match(build, /os: macos-26[\s\S]*xcode: '26\.6'[\s\S]*consumer_ios: '14\.0'/);
  assert.match(build, /os: xcode-27[\s\S]*xcode: '27\.1'[\s\S]*consumer_ios: '15\.0'/);
  assert.match(build, /coverage: true/);
  assert.match(build, /if: matrix\.coverage/);
  assert.match(
    build,
    /--consumer-target "arm64-apple-ios\$\{\{ matrix\.consumer_ios \}\}-simulator"/,
  );
});

test('iOS smoke and platform builds use current Xcode 26.6 on macos-26', () => {
  const smoke = job('smoke-test');
  const platforms = job('build-platforms');
  assert.match(smoke, /runs-on: macos-26/);
  assert.match(smoke, /Xcode_26\.6\.app/);
  assert.match(platforms, /runs-on: macos-26/);
  assert.match(platforms, /Xcode_26\.6\.app/);
});
