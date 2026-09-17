import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Fail-closed CI standard (OPS-1258): quality gates (clippy, cargo-audit,
// test steps) must not swallow failures via `continue-on-error: true`, and
// the jobs that catch those failures must be required by the Analysis
// Summary. See `.github/actions/verify-required-jobs` for how `required-jobs`
// is enforced.

const rustWorkflow = readFileSync(new URL('./analysis-rust.yml', import.meta.url), 'utf8');
const javaWorkflow = readFileSync(new URL('./analysis-java.yml', import.meta.url), 'utf8');

/**
 * Extract the raw YAML block for a named step, starting at its
 * `- name: <name>` line and ending right before the next `- name:` line (or
 * the next top-level job key). This intentionally works on the raw text
 * rather than a full YAML parse so it stays durable against unrelated
 * formatting changes elsewhere in the file.
 */
function stepBlock(workflow, stepName) {
  const escaped = stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`- name: ${escaped}\\n([\\s\\S]*?)(?=\\n\\s*- name:|\\n {0,2}\\S[^\\n]*:\\n|$)`);
  const match = workflow.match(pattern);
  assert.ok(match, `expected to find a "${stepName}" step`);
  return match[0];
}

test('rust clippy step does not swallow failures with continue-on-error', () => {
  const block = stepBlock(rustWorkflow, 'Run clippy');
  assert.doesNotMatch(block, /continue-on-error/);
  assert.match(block, /-D warnings/);
});

test('rust cargo-audit step does not swallow failures with continue-on-error', () => {
  const block = stepBlock(rustWorkflow, 'Run security audit');
  assert.doesNotMatch(block, /continue-on-error/);
});

test('rust Analysis Summary requires the security (cargo-audit) job', () => {
  const summary = rustWorkflow.slice(rustWorkflow.indexOf('\n  summary:'));
  const requiredJobs = summary.match(/required-jobs: ([^\n]+)/)?.[1];
  assert.ok(requiredJobs, 'analysis summary must verify required jobs');
  assert.match(requiredJobs, /\bsecurity\b/);
});

test('java Run tests step does not swallow failures with continue-on-error', () => {
  const block = stepBlock(javaWorkflow, 'Run tests');
  assert.doesNotMatch(block, /continue-on-error/);
});
