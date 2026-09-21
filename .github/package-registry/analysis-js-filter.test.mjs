import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAnalysisJs } from './analysis-js-filter.mjs';

test('all includes default required jobs and full matrix', () => {
  const r = filterAnalysisJs('all');
  assert.equal(r.filter, 'all');
  assert.ok(r.testMatrix.length >= 10);
  assert.ok(r.requiredJobs.includes('test'));
  assert.ok(r.requiredJobs.includes('solidstart-host'));
  assert.ok(r.requiredJobs.includes('test-astro-hosts'));
  assert.equal(r.runTestAstroHosts, true);
  assert.equal(r.needSharedDeps, true);
});

test('SolidJS-only skips shared deps artifact', () => {
  const r = filterAnalysisJs('SolidJS');
  assert.equal(r.needSharedDeps, false);
  assert.equal(r.runTest, true);
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

test('Client-Telemetry runs coverage and packed consumers without shared dependency artifacts', () => {
  const result = filterAnalysisJs('Client-Telemetry');
  assert.equal(result.needSharedDeps, false);
  assert.deepEqual(result.testMatrix, [{ sdk: 'Client-Telemetry', path: 'toggly-client-telemetry', 'test-cmd': 'npm run test:coverage && npm run test:packed', 'has-lint': false }]);
  assert.ok(result.requiredJobs.split(',').includes('test'));
});

test('Client-Core runs coverage and its packed browser host from the standalone package', () => {
  const result = filterAnalysisJs('Client-Core');
  assert.equal(result.needSharedDeps, false);
  assert.deepEqual(result.testMatrix, [{
    sdk: 'Client-Core',
    path: 'toggly-docusaurus-edge-sdk/libs/core',
    'test-cmd': 'npm run test:coverage && npm run test:packed',
    'node-version': '24.x',
    'has-lint': false,
  }]);
  assert.ok(result.requiredJobs.split(',').includes('test'));
});
