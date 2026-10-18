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
  const sha = String(env.GITHUB_SHA || '').trim();
  if (!sha) {
    throw new Error('GITHUB_SHA is required');
  }
  return sha;
}

/** GitHub dispatch ref must be the exact commit, not a branch name that can advance. */
export function buildWorkflowDispatchPayload(targetSha) {
  return {
    ref: targetSha,
    inputs: {
      target_sha: targetSha,
    },
  };
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

export function pickRelevantRun(runs, workflowName = WORKFLOW_NAME) {
  return runs.find((run) => run.name === workflowName) ?? runs[0];
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
    const data = await github(
      `/actions/workflows/${workflow.id}/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
    );
    const runs = data.workflow_runs || [];
    const run = pickRelevantRun(runs);

    if (run?.head_sha && run.head_sha !== sha) {
      throw new Error(`Matched workflow run ${run.id} has head_sha ${run.head_sha}, expected ${sha}`);
    }

    if (run?.status === 'completed') {
      if (run.conclusion === 'success') {
        return { analysisRunUrl: run.html_url, targetSha: sha };
      }
      throw new Error(`Aggregate analysis failed (${run.conclusion}): ${run.html_url}`);
    }

    if (run?.status === 'in_progress' || run?.status === 'queued' || run?.status === 'waiting') {
      await sleep(pollMs);
      continue;
    }

    if (!dispatched) {
      const payload = buildWorkflowDispatchPayload(sha);
      await github(`/actions/workflows/${workflow.id}/dispatches`, {
        method: 'POST',
        body: payload,
      });
      dispatched = true;
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
