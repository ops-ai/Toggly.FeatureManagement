import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIVE_RUN_STATUSES,
  buildWorkflowDispatchPayload,
  findSuccessfulAnalysisViaCheckRuns,
  pickRelevantRun,
  waitForAggregateAnalysis,
  WORKFLOW_NAME,
} from './wait-javascript-aggregate-analysis.mjs';

test('dispatch payload uses branch ref and pins target_sha input', () => {
  const sha = 'abc123def456';
  assert.deepEqual(
    buildWorkflowDispatchPayload(sha, { GITHUB_REF: 'refs/heads/develop' }),
    { ref: 'develop', inputs: { target_sha: sha } },
  );
});

test('dispatch is disabled on pull-request refs', () => {
  assert.throws(
    () => buildWorkflowDispatchPayload('abc', { GITHUB_REF: 'refs/pull/808/merge' }),
    /Cannot dispatch/,
  );
});

test('findSuccessfulAnalysisViaCheckRuns resolves the JavaScript workflow run URL', async () => {
  const sha = 'abc123';
  const fetchImpl = async (url) => {
    if (url.includes('/check-runs')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          check_runs: [{
            name: 'SonarQube Analysis',
            status: 'completed',
            conclusion: 'success',
            details_url: 'https://github.com/org/repo/actions/runs/99/job/1',
          }],
        }),
      };
    }
    if (url.endsWith('/actions/runs/99')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: WORKFLOW_NAME,
          head_sha: sha,
          conclusion: 'success',
          html_url: 'https://example.com/run/99',
        }),
      };
    }
    throw new Error(url);
  };
  const github = async (path, opts) => {
    const url = `https://api.github.com/repos/ops-ai/Toggly.FeatureManagement${path}`;
    const response = await fetchImpl(url, opts);
    if (!response.ok) {
      throw new Error(`GitHub API ${opts?.method || 'GET'} ${path} -> ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };
  const url = await findSuccessfulAnalysisViaCheckRuns(github, sha);
  assert.equal(url, 'https://example.com/run/99');
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

test('ACTIVE_RUN_STATUSES includes pending so waiters do not double-dispatch', () => {
  assert.equal(ACTIVE_RUN_STATUSES.has('pending'), true);
});

test('waitForAggregateAnalysis waits on pending runs without dispatching', async () => {
  const sha = 'pending123';
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/actions/workflows?per_page=100')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflows: [{ id: 99, path: '.github/workflows/analysis-javascript.yml' }],
        }),
      };
    }
    if (url.includes('/runs?head_sha=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [
            {
              name: WORKFLOW_NAME,
              status: 'pending',
              head_sha: sha,
              html_url: 'https://example.com/run/pending',
            },
          ],
        }),
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
        maxMs: 3,
        fetchImpl,
        sleep: async () => {},
        env: { GITHUB_REF: 'refs/heads/develop' },
      }),
    /Timed out/,
  );

  assert.equal(calls.some((url) => url.includes('/dispatches')), false);
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
    if (url.includes('/check-runs')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
      };
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
        env: { GITHUB_REF: 'refs/heads/develop' },
      }),
    /Timed out/,
  );

  assert.deepEqual(
    dispatchBody,
    buildWorkflowDispatchPayload(sha, { GITHUB_REF: 'refs/heads/develop' }),
  );
});
