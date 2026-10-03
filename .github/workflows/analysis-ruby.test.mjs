import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('./analysis-ruby.yml', import.meta.url), 'utf8');

function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const next = workflow.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

test('Ruby reporting jobs use toJSON(run_reporting) fail-open for string false', () => {
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
