import { fileURLToPath } from 'node:url';

export function splitJobList(value) {
  return String(value ?? '')
    .split(',')
    .map((job) => job.trim())
    .filter(Boolean);
}

export function failedRequiredJobs(needs, requiredJobs, allowSkipped = []) {
  const allow = new Set(allowSkipped);
  return requiredJobs.filter((job) => {
    const result = needs[job]?.result;
    if (result === 'success') return false;
    if (result === 'skipped' && allow.has(job)) return false;
    return true;
  });
}

export function verifyRequiredJobs(needs, requiredJobs, allowSkipped = []) {
  const failed = failedRequiredJobs(needs, requiredJobs, allowSkipped);
  if (failed.length) {
    const lines = failed.map((job) => `  ${job}: ${needs[job]?.result ?? 'missing'}`);
    const error = new Error(`Required jobs did not succeed:\n${lines.join('\n')}`);
    error.failed = failed;
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');
  const required = splitJobList(process.env.REQUIRED_JOBS);
  const allowSkipped = splitJobList(process.env.ALLOW_SKIPPED);
  try {
    verifyRequiredJobs(needs, required, allowSkipped);
    console.log('All required jobs passed:', required.join(', '));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
