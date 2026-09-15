import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAnalysisJs } from './analysis-js-filter.mjs';

test('all includes default required jobs and full matrix', () => {
  const r = filterAnalysisJs('all');
  assert.equal(r.filter, 'all');
  assert.ok(r.testMatrix.length >= 10);
  assert.ok(r.requiredJobs.includes('test'));
  assert.ok(r.requiredJobs.includes('solidstart-host'));
  assert.equal(r.runTestAstroHosts, true);
});

test('Vue filter limits matrix and requires browser hosts', () => {
  const r = filterAnalysisJs('Vue');
  assert.deepEqual(
    r.testMatrix.map((x) => x.sdk),
    ['Vue'],
  );
  assert.equal(r.runTest, true);
  assert.equal(r.runTestCurrentBrowserHosts, true);
  assert.equal(r.runSolidstartHost, false);
  assert.equal(r.runTestNodeServer, false);
  assert.ok(r.requiredJobs.split(',').includes('test'));
  assert.ok(r.requiredJobs.split(',').includes('test-current-browser-hosts'));
  assert.ok(!r.requiredJobs.split(',').includes('solidstart-host'));
});

test('SolidJS requires solidstart-host', () => {
  const r = filterAnalysisJs('SolidJS');
  assert.equal(r.runSolidstartHost, true);
  assert.ok(r.requiredJobs.includes('solidstart-host'));
});

test('node-server special filter', () => {
  const r = filterAnalysisJs('node-server');
  assert.equal(r.runTest, false);
  assert.equal(r.runTestNodeServer, true);
  assert.equal(r.runSmokeTestNodeServer, true);
});

test('unknown SDK throws', () => {
  assert.throws(() => filterAnalysisJs('Nope'), /Unknown analysis SDK/);
});
