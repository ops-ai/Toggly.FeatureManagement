#!/usr/bin/env node
/**
 * Release gate: wait for (or trigger) a successful full JavaScript/TypeScript
 * aggregate analysis on the current commit (OPS-1900).
 */

const WORKFLOW_PATH = '.github/workflows/analysis-javascript.yml';
const WORKFLOW_NAME = 'JavaScript/TypeScript SDKs - Tests & Analysis';

const owner = process.env.GITHUB_REPOSITORY?.split('/')[0];
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const sha = process.env.GITHUB_SHA;
const ref = process.env.GITHUB_REF_NAME || 'develop';
const pollMs = Number(process.env.POLL_INTERVAL_MS || 30_000);
const maxMs = Number(process.env.MAX_WAIT_MINUTES || 150) * 60_000;

if (!owner || !repo || !token || !sha) {
  console.error('GITHUB_REPOSITORY, GITHUB_TOKEN, and GITHUB_SHA are required');
  process.exit(1);
}

async function github(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
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
}

async function resolveWorkflowId() {
  const data = await github('/actions/workflows?per_page=100');
  const match = data.workflows.find((workflow) => workflow.path === WORKFLOW_PATH);
  if (!match) {
    throw new Error(`Workflow not found at ${WORKFLOW_PATH}`);
  }
  return match.id;
}

async function listRunsForSha(workflowId) {
  const data = await github(
    `/actions/workflows/${workflowId}/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
  );
  return data.workflow_runs || [];
}

function pickRelevantRun(runs) {
  return runs.find((run) => run.name === WORKFLOW_NAME) ?? runs[0];
}

async function dispatchWorkflow(workflowId) {
  console.log(`Dispatching ${WORKFLOW_NAME} on ref ${ref} for ${sha}`);
  await github(`/actions/workflows/${workflowId}/dispatches`, {
    method: 'POST',
    body: { ref },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const workflowId = await resolveWorkflowId();
  const started = Date.now();
  let dispatched = false;

  while (Date.now() - started < maxMs) {
    const runs = await listRunsForSha(workflowId);
    const run = pickRelevantRun(runs);

    if (run?.status === 'completed') {
      if (run.conclusion === 'success') {
        console.log(`Aggregate analysis succeeded: ${run.html_url}`);
        if (process.env.GITHUB_OUTPUT) {
          const { appendFileSync } = await import('node:fs');
          appendFileSync(process.env.GITHUB_OUTPUT, `analysis_run_url=${run.html_url}\n`);
        }
        return;
      }
      throw new Error(`Aggregate analysis failed (${run.conclusion}): ${run.html_url}`);
    }

    if (run?.status === 'in_progress' || run?.status === 'queued' || run?.status === 'waiting') {
      console.log(`Waiting for aggregate analysis (${run.status}): ${run.html_url}`);
      await sleep(pollMs);
      continue;
    }

    if (!dispatched) {
      await dispatchWorkflow(workflowId);
      dispatched = true;
      await sleep(pollMs);
      continue;
    }

    console.log('No aggregate analysis run visible yet; polling…');
    await sleep(pollMs);
  }

  throw new Error(`Timed out after ${maxMs / 60_000} minutes waiting for ${WORKFLOW_NAME} on ${sha}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
