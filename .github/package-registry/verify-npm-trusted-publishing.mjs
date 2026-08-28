#!/usr/bin/env node
/**
 * Assert inventoried npm release workflows use OIDC trusted publishing
 * without NODE_AUTH_TOKEN / secrets.NPM_TOKEN fallback (OPS-727 Task 4).
 *
 * Packages with oidcReady=false are reported but do not fail until marked ready.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './verify-npm-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function workflowBasenames(inventory) {
  const set = new Set();
  for (const pkg of inventory.packages) {
    set.add(pkg.workflow);
  }
  return [...set].sort();
}

function analyzeWorkflow(content) {
  const issues = [];
  if (!/id-token:\s*write/.test(content)) {
    issues.push('missing permissions id-token: write');
  }
  if (/secrets\.NPM_TOKEN/.test(content)) {
    issues.push('still references secrets.NPM_TOKEN');
  }
  // Empty NODE_AUTH_TOKEN clears environment-injected tokens so OIDC wins.
  const forbiddenToken = content.split('\n').some((line) => {
    const trimmed = line.trim();
    if (!/NODE_AUTH_TOKEN\s*:/.test(trimmed) || trimmed.startsWith('#')) {
      return false;
    }
    return !/NODE_AUTH_TOKEN\s*:\s*(?:''|"")\s*$/.test(trimmed);
  });
  if (forbiddenToken) {
    issues.push('still sets a non-empty NODE_AUTH_TOKEN');
  }
  if (/\|\|\s*(npm|pnpm)\s+publish/.test(content)) {
    issues.push('has non-provenance || publish fallback');
  }
  const hasProvenancePublish =
    /(npm|pnpm)\s+publish[^\n]*--provenance/.test(content) ||
    /publish\s+--provenance/.test(content);
  if (!hasProvenancePublish) {
    issues.push('missing publish --provenance');
  }
  // Node floor: allow setup-node with 22.14+ or '22' / 'lts/*' when npm>=11.5 is enforced elsewhere
  const nodeMatch = content.match(/node-version:\s*['"]?([^\s'"]+)/);
  if (nodeMatch) {
    const v = nodeMatch[1];
    if (/^\d+$/.test(v) && Number(v) < 22) {
      issues.push(`node-version ${v} is below 22`);
    }
    if (/^\d+\.\d+/.test(v)) {
      const [maj, min, patch = '0'] = v.split('.').map(Number);
      if (maj < 22 || (maj === 22 && (min < 14 || (min === 14 && patch < 0)))) {
        // 22.14.0 floor when fully pinned
        if (!(maj > 22 || (maj === 22 && min >= 14))) {
          issues.push(`node-version ${v} is below 22.14`);
        }
      }
    }
  }
  return issues;
}

export function verifyNpmTrustedPublishing({ repoRoot = REPO_ROOT } = {}) {
  const inventory = loadInventory();
  const errors = [];
  const pending = [];
  const workflows = workflowBasenames(inventory);

  for (const workflow of workflows) {
    const abs = path.join(repoRoot, workflow);
    if (!fs.existsSync(abs)) {
      errors.push(`missing workflow ${workflow}`);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    const issues = analyzeWorkflow(content);
    const pkgs = inventory.packages.filter((p) => p.workflow === workflow);
    const allReady = pkgs.every((p) => p.oidcReady === true);
    if (issues.length === 0) continue;
    if (allReady) {
      for (const issue of issues) {
        errors.push(`${workflow}: ${issue}`);
      }
    } else {
      pending.push({
        workflow,
        packages: pkgs.map((p) => p.name),
        issues,
      });
    }
  }

  return { ok: errors.length === 0, errors, pending };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyNpmTrustedPublishing();
  if (result.pending.length) {
    console.log(`OIDC pending (${result.pending.length} workflow(s) still allow token fallback):`);
    for (const p of result.pending) {
      console.log(` - ${p.workflow}: ${p.issues.join('; ')}`);
    }
  }
  if (!result.ok) {
    console.error(`trusted publishing contract failed (${result.errors.length} error(s)):`);
    for (const e of result.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log('trusted publishing contract ok for oidcReady workflows');
}
