import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWorkflowDispatchPayload,
  pickRelevantRun,
  waitForAggregateAnalysis,
  WORKFLOW_NAME,
} from './wait-javascript-aggregate-analysis.mjs';

test('dispatch payload pins ref and workflow input to the target SHA', () => {
  const sha = 'abc123def456';
  assert.deepEqual(buildWorkflowDispatchPayload(sha), {
    ref: sha,
    inputs: { target_sha: sha },
  });
});

test('pickRelevantRun prefers the aggregate analysis workflow name', () => {
  const runs = [
    { name: 'Other', status: 'completed' },
    { name: WORKFLOW_NAME, status: 'queued', head_sha: 'abc' },
  ];
  assert.equal(pickRelevantRun(runs).name, WORKFLOW_NAME);
});

test('waitForAggregateAnalysis returns when a successful run exists for the SHA', async () => {
  const sha = 'deadbeef';
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/actions/workflows?per_page=100')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflows: [{ id: 99, path: '.github/workflows/analysis-javascript.yml' }],
        }),
      };
    }
    if (url.includes('/dispatches')) {
      return { ok: true, status: 204, json: async () => null };
    }
    if (url.includes('/runs?head_sha=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [
            {
              name: WORKFLOW_NAME,
              status: 'completed',
              conclusion: 'success',
              head_sha: sha,
              html_url: 'https://example.com/run/1',
            },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await waitForAggregateAnalysis({
    owner: 'ops-ai',
    repo: 'Toggly.FeatureManagement',
    token: 'token',
    targetSha: sha,
    pollMs: 1,
    maxMs: 1000,
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(result.analysisRunUrl, 'https://example.com/run/1');
  assert.equal(result.targetSha, sha);
  const dispatch = calls.find((call) => call.url.includes('/dispatches'));
  assert.equal(dispatch, undefined);
});

test('waitForAggregateAnalysis dispatches with the commit SHA when no run exists', async () => {
  const sha = 'cafebabe';
  let dispatchBody;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/actions/workflows?per_page=100')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflows: [{ id: 42, path: '.github/workflows/analysis-javascript.yml' }],
        }),
      };
    }
    if (url.includes('/dispatches')) {
      dispatchBody = JSON.parse(options.body);
      return { ok: true, status: 204, json: async () => null };
    }
    if (url.includes('/runs?head_sha=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: [] }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  await assert.rejects(
    () =>
      waitForAggregateAnalysis({
        owner: 'ops-ai',
        repo: 'Toggly.FeatureManagement',
        token: 'token',
        targetSha: sha,
        pollMs: 1,
        maxMs: 5,
        fetchImpl,
        sleep: async () => {},
      }),
    /Timed out/,
  );

  assert.deepEqual(dispatchBody, buildWorkflowDispatchPayload(sha));
});
