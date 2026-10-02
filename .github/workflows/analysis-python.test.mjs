import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
