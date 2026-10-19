#!/usr/bin/env node
/**
 * Release gate: wait for (or trigger) a successful full JavaScript/TypeScript
 * aggregate analysis on the current commit (OPS-1900).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_PATH = '.github/workflows/analysis-javascript.yml';
export const WORKFLOW_NAME = 'JavaScript/TypeScript SDKs - Tests & Analysis';

export function resolveTargetSha(env = process.env) {
  const sha = String(env.COMMIT_SHA || env.GITHUB_SHA || '').trim();
  if (!sha) {
    throw new Error('COMMIT_SHA or GITHUB_SHA is required');
  }
  return sha;
}

export function resolveDispatchRef(env = process.env) {
  const ref = String(env.GITHUB_REF || '');
  if (ref.startsWith('refs/heads/')) {
    return ref.slice('refs/heads/'.length);
  }
  if (ref.startsWith('refs/pull/')) {
    return '';
  }
  return String(env.GITHUB_REF_NAME || 'develop').trim() || 'develop';
}

/** Dispatch on a branch ref; analysis checks out inputs.target_sha inside the workflow. */
export function buildWorkflowDispatchPayload(targetSha, env = process.env) {
  const ref = resolveDispatchRef(env);
  if (!ref) {
    throw new Error('Cannot dispatch analysis from a pull-request ref; wait for an existing run on the commit');
  }
  return {
    ref,
    inputs: {
      target_sha: targetSha,
    },
  };
}

export function canDispatchAnalysis(env = process.env) {
  return Boolean(resolveDispatchRef(env));
}

export function createGithubClient({ owner, repo, token, fetchImpl = fetch }) {
  if (!owner || !repo || !token) {
    throw new Error('owner, repo, and token are required');
  }

  return async function github(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${method} ${path} -> ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    return response.json();
  };
}

export const ACTIVE_RUN_STATUSES = new Set([
  'in_progress',
  'queued',
  'waiting',
  'pending',
  'requested',
]);

export function pickRelevantRun(runs, workflowName = WORKFLOW_NAME) {
  const relevant = runs
    .filter((run) => run.name === workflowName)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const success = relevant.find(
    (run) => run.status === 'completed' && run.conclusion === 'success',
  );
  if (success) return success;
  return relevant[0];
}

export async function findSuccessfulAnalysisViaCheckRuns(github, targetSha) {
  const data = await github(
    `/commits/${encodeURIComponent(targetSha)}/check-runs?per_page=100`,
  );
  for (const checkRun of data.check_runs || []) {
    if (checkRun.name !== 'SonarQube Analysis') continue;
    if (checkRun.status !== 'completed' || checkRun.conclusion !== 'success') continue;
    const runId = checkRun.details_url?.match(/actions\/runs\/(\d+)/)?.[1];
    if (!runId) continue;
    const run = await github(`/actions/runs/${runId}`);
    if (run.name !== WORKFLOW_NAME || run.head_sha !== targetSha) continue;
    if (run.conclusion !== 'success') continue;
    return run.html_url;
  }
  return null;
}

export async function listAggregateRuns(github, targetSha) {
  const byWorkflow = await github(
    `/actions/runs?head_sha=${encodeURIComponent(targetSha)}&per_page=30`,
  );
  const runs = (byWorkflow.workflow_runs || []).filter((run) => run.name === WORKFLOW_NAME);
  if (runs.length > 0) {
    return runs;
  }
  const workflows = await github('/actions/workflows?per_page=100');
  const workflow = workflows.workflows.find((entry) => entry.path === WORKFLOW_PATH);
  if (!workflow) {
    throw new Error(`Workflow not found at ${WORKFLOW_PATH}`);
  }
  const scoped = await github(
    `/actions/workflows/${workflow.id}/runs?head_sha=${encodeURIComponent(targetSha)}&per_page=20`,
  );
  return scoped.workflow_runs || [];
}

export async function waitForAggregateAnalysis({
  owner,
  repo,
  token,
  targetSha,
  pollMs = 30_000,
  maxMs = 150 * 60_000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env = process.env,
} = {}) {
  const sha = targetSha || resolveTargetSha();
  const github = createGithubClient({ owner, repo, token, fetchImpl });

  const workflows = await github('/actions/workflows?per_page=100');
  const workflow = workflows.workflows.find((entry) => entry.path === WORKFLOW_PATH);
  if (!workflow) {
    throw new Error(`Workflow not found at ${WORKFLOW_PATH}`);
  }

  const started = Date.now();
  let dispatched = false;

  while (Date.now() - started < maxMs) {
    const runs = await listAggregateRuns(github, sha);
    const run = pickRelevantRun(runs);

    if (!run) {
      const checkRunUrl = await findSuccessfulAnalysisViaCheckRuns(github, sha);
      if (checkRunUrl) {
        return { analysisRunUrl: checkRunUrl, targetSha: sha };
      }
    }

    if (run?.head_sha && run.head_sha !== sha) {
      throw new Error(`Matched workflow run ${run.id} has head_sha ${run.head_sha}, expected ${sha}`);
    }

    if (run?.status === 'completed') {
      if (run.conclusion === 'success') {
        return { analysisRunUrl: run.html_url, targetSha: sha };
      }
      const rerunning = runs.some(
        (entry) =>
          entry.name === WORKFLOW_NAME &&
          entry.id !== run.id &&
          ACTIVE_RUN_STATUSES.has(entry.status),
      );
      if (rerunning) {
        console.log(`Aggregate analysis failed (${run.conclusion}); waiting on a newer run`);
        await sleep(pollMs);
        continue;
      }
      console.log(
        `Aggregate analysis failed (${run.conclusion}): ${run.html_url}; waiting for a later attempt`,
      );
      await sleep(pollMs);
      continue;
    }

    if (run && ACTIVE_RUN_STATUSES.has(run.status)) {
      console.log(`Waiting for aggregate analysis (${run.status}): ${run.html_url}`);
      await sleep(pollMs);
      continue;
    }

    if (!dispatched && canDispatchAnalysis(env)) {
      const payload = buildWorkflowDispatchPayload(sha, env);
      await github(`/actions/workflows/${workflow.id}/dispatches`, {
        method: 'POST',
        body: payload,
      });
      dispatched = true;
      await sleep(pollMs);
      continue;
    }

    if (!dispatched && !canDispatchAnalysis(env)) {
      await sleep(pollMs);
      continue;
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out after ${maxMs / 60_000} minutes waiting for ${WORKFLOW_NAME} on ${sha}`);
}

async function main() {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const targetSha = resolveTargetSha();
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 30_000);
  const maxMs = Number(process.env.MAX_WAIT_MINUTES || 150) * 60_000;

  if (!owner || !repo || !token) {
    console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
    process.exit(1);
  }

  const result = await waitForAggregateAnalysis({
    owner,
    repo,
    token,
    targetSha,
    pollMs,
    maxMs,
  });

  console.log(`Aggregate analysis succeeded: ${result.analysisRunUrl}`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `analysis_run_url=${result.analysisRunUrl}\n`);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
