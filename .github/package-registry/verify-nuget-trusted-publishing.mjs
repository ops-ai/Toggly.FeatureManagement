#!/usr/bin/env node
/**
 * Assert sdk-dotnet-release.yml publishes via NuGet OIDC trusted publishing
 * without secrets.NUGET_API_KEY, while keeping Key Vault signing (OPS-726).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_NUGET_SIGN_SECRETS } from './verify-nuget-sourcelink.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/sdk-dotnet-release.yml');

const REQUIRED_SIGN_SECRETS = REQUIRED_NUGET_SIGN_SECRETS;

/**
 * Extract a top-level job body by name (YAML indentation: 2 spaces under jobs:).
 */
export function extractJob(content, jobName) {
  const jobsMatch = content.match(/^jobs:\s*\n/m);
  if (!jobsMatch) return null;
  const jobsStart = jobsMatch.index + jobsMatch[0].length;
  const jobsSection = content.slice(jobsStart);
  const jobRe = new RegExp(`^  ${jobName}:\\s*\\n`, 'm');
  const jobMatch = jobRe.exec(jobsSection);
  if (!jobMatch) return null;
  const afterHeader = jobsSection.slice(jobMatch.index + jobMatch[0].length);
  const nextJob = afterHeader.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return nextJob === -1 ? afterHeader : afterHeader.slice(0, nextJob);
}

/**
 * True when the job block (or nested permissions:) declares id-token: write.
 */
export function jobHasIdTokenWrite(jobBody) {
  if (!jobBody) return false;
  if (/^ {4}id-token:\s*write\s*$/m.test(jobBody)) return true;
  const perms = jobBody.match(/^ {4}permissions:\s*\n((?: {6}.+\n)*)/m);
  if (perms && /id-token:\s*write/.test(perms[1])) return true;
  return /id-token:\s*write/.test(jobBody);
}

export function analyzeNugetTrustedPublishing(content) {
  const errors = [];

  if (/^\s*workflow_call\s*:/m.test(content)) {
    errors.push('must not use workflow_call reusable-workflow publish path');
  }

  const publishJob = extractJob(content, 'publish');
  if (!publishJob) {
    errors.push('missing publish job');
    return errors;
  }

  if (!jobHasIdTokenWrite(publishJob)) {
    errors.push('publish job missing permissions id-token: write');
  }

  if (!/^ {4}environment:\s*nuget-publish\s*$/m.test(publishJob)) {
    errors.push('publish job missing environment: nuget-publish');
  }

  if (!/NuGet\/login@v1(?:\.\d+)?\b/.test(content)) {
    errors.push('missing NuGet/login@v1 (or @v1.x)');
  }

  // nuget.org matches OIDC to the trust-policy creator, not package owner.
  if (!/user:\s*opsai\b/.test(content)) {
    errors.push('NuGet/login user must be trust-policy creator opsai (not Toggly org)');
  }
  if (/user:\s*Toggly\b/.test(content)) {
    errors.push('NuGet/login user must not be package-owner org Toggly');
  }

  if (/secrets\.NUGET_API_KEY/.test(content)) {
    errors.push('still references secrets.NUGET_API_KEY on push');
  }

  for (const secret of REQUIRED_SIGN_SECRETS) {
    if (!content.includes(secret)) {
      errors.push(`missing signing secret reference: ${secret}`);
    }
  }

  return errors;
}

export function verifyNugetTrustedPublishing({
  repoRoot = REPO_ROOT,
  workflowPath = path.join(repoRoot, '.github/workflows/sdk-dotnet-release.yml'),
} = {}) {
  if (!fs.existsSync(workflowPath)) {
    return { ok: false, errors: [`missing workflow: ${workflowPath}`] };
  }
  const content = fs.readFileSync(workflowPath, 'utf8');
  const errors = analyzeNugetTrustedPublishing(content);
  return { ok: errors.length === 0, errors };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyNugetTrustedPublishing();
  if (!result.ok) {
    console.error(`NuGet trusted publishing contract failed (${result.errors.length} error(s)):`);
    for (const e of result.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log('NuGet trusted publishing contract ok');
}
