import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Fail-closed CI (OPS-1258): Node Audit scans that include many lockfiles
// hit registry.npmjs.org with 429s when they also walk host-fixtures,
// packaging trees, and node_modules. Those trees are not published SDKs.
// Every analysis workflow that leaves Node Audit enabled must exclude them.

const workflowsDir = fileURLToPath(new URL('.', import.meta.url));

function readWorkflow(name) {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

const nodeAuditWorkflows = readdirSync(workflowsDir)
  .filter((name) => /^analysis-.*\.yml$/.test(name))
  .filter((name) => {
    const workflow = readWorkflow(name);
    return (
      workflow.includes('Dependency-Check_Action') && !/--disableNodeAudit\b/.test(workflow)
    );
  })
  .sort();

assert.ok(
  nodeAuditWorkflows.length > 0,
  'expected at least one analysis workflow with Node Audit enabled',
);

const requiredExcludes = [
  '--exclude .*/host-fixtures/.*',
  '--exclude .*/node_modules/.*',
  '--exclude .*/packaging/.*',
  '--nodeAuditSkipDevDependencies',
];

for (const name of nodeAuditWorkflows) {
  test(`${name} excludes fixture and packaging trees from Node Audit`, () => {
    const workflow = readWorkflow(name);
    for (const flag of requiredExcludes) {
      assert.ok(
        workflow.includes(flag),
        `${name} must pass ${flag} to OWASP Dependency-Check so Node Audit does not scan non-product lockfiles or fail closed on npm 429s`,
      );
    }
  });
}
