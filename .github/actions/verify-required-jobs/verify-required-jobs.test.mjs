import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failedRequiredJobs, splitJobList, verifyRequiredJobs } from './verify-required-jobs.mjs';

test('treats skipped OWASP jobs as success so release gates can omit reporting', () => {
  const failed = failedRequiredJobs(
    { test: { result: 'success' }, 'dependency-check': { result: 'skipped' } },
    ['test', 'dependency-check'],
    ['dependency-check', 'dependency-check-providers'],
  );
  assert.deepEqual(failed, []);
});

test('still fails when a required test is skipped', () => {
  const failed = failedRequiredJobs(
    { test: { result: 'skipped' }, 'dependency-check': { result: 'success' } },
    ['test', 'dependency-check'],
    ['dependency-check'],
  );
  assert.deepEqual(failed, ['test']);
});

test('still fails when OWASP actually fails', () => {
  const failed = failedRequiredJobs(
    { test: { result: 'success' }, 'dependency-check': { result: 'failure' } },
    ['test', 'dependency-check'],
    ['dependency-check'],
  );
  assert.deepEqual(failed, ['dependency-check']);
});

test('splitJobList trims the default allow-skipped list', () => {
  assert.deepEqual(splitJobList('dependency-check,dependency-check-providers'), [
    'dependency-check',
    'dependency-check-providers',
  ]);
});

test('verifyRequiredJobs throws with missing jobs', () => {
  assert.throws(
    () => verifyRequiredJobs({ test: { result: 'success' } }, ['test', 'smoke-test'], []),
    /smoke-test: missing/,
  );
});
