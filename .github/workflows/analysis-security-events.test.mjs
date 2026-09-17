import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Fail-closed CI standard (OPS-1258): every `analysis-*.yml` reusable
// workflow must be able to upload SARIF (OWASP Dependency-Check today,
// possibly other scanners later) without the caller's GITHUB_TOKEN
// permission intersection silently dropping the upload. That requires
// `security-events: write` on:
//   1. every `analysis-*.yml` workflow itself, and
//   2. every `sdk-*-release.yml` that calls an `analysis-*.yml` as a
//      `uses:` job (e.g. a `gates` job) — reusable-workflow permissions
//      are the *intersection* of caller and callee, so the release
//      workflow's own token also needs the scope.
//
// This test is intentionally workflow-agnostic (it globs the directory)
// so a newly added SDK family fails closed by default instead of relying
// on someone remembering to copy the permissions block.

const workflowsDir = fileURLToPath(new URL('.', import.meta.url));

function readWorkflow(name) {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

const analysisWorkflows = readdirSync(workflowsDir)
  .filter((name) => /^analysis-.*\.yml$/.test(name))
  .sort();

const releaseWorkflows = readdirSync(workflowsDir)
  .filter((name) => /^sdk-.*-release\.yml$/.test(name))
  .sort();

assert.ok(analysisWorkflows.length > 0, 'expected to find analysis-*.yml workflows');
assert.ok(releaseWorkflows.length > 0, 'expected to find sdk-*-release.yml workflows');

function hasSecurityEventsWrite(workflow) {
  // Match within a `permissions:` block (top-level or job-level would also
  // satisfy GitHub Actions' permission model at the workflow level, but we
  // only ever set this at the top level in this repo, so a direct
  // substring match on the key/value pair is durable and simple).
  return /security-events:\s*write/.test(workflow);
}

for (const name of analysisWorkflows) {
  test(`${name} declares permissions.security-events: write`, () => {
    const workflow = readWorkflow(name);
    assert.ok(
      hasSecurityEventsWrite(workflow),
      `${name} must grant security-events: write so SARIF uploads (OWASP Dependency-Check, etc.) do not silently fail`
    );
  });
}

for (const name of releaseWorkflows) {
  const workflow = readWorkflow(name);
  const usesAnalysisWorkflow = /uses:\s*\.\/\.github\/workflows\/analysis-[\w-]+\.yml/.test(workflow);

  if (!usesAnalysisWorkflow) {
    continue;
  }

  test(`${name} declares permissions.security-events: write (calls an analysis-*.yml gate)`, () => {
    assert.ok(
      hasSecurityEventsWrite(workflow),
      `${name} calls an analysis-*.yml workflow as a gate; the caller's token must also grant ` +
        'security-events: write or the reusable-workflow permission intersection drops the SARIF upload'
    );
  });
}
