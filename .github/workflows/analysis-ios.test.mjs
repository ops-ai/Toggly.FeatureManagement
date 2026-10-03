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

test('iOS Sonar excludes swift:S4790 on SignedDefsVerify (wire-format kid SHA-1)', () => {
  const sonar = job('sonar');
  for (const name of ['SonarCloud Scan', 'SonarQube Server Scan']) {
    const start = sonar.indexOf(`      - name: ${name}\n`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = sonar.indexOf('\n      - name:', start + 1);
    const step = next === -1 ? sonar.slice(start) : sonar.slice(start, next);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria=kidSha1/);
    assert.match(step, /-Dsonar\.issue\.ignore\.multicriteria\.kidSha1\.ruleKey=swift:S4790/);
    assert.match(
      step,
      /-Dsonar\.issue\.ignore\.multicriteria\.kidSha1\.resourceKey=\*\*\/SignedDefsVerify\.swift/,
    );
  }
});
