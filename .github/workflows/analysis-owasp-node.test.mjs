import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Fail-closed CI (OPS-1258): Dependency-Check's Node Audit analyzer talks
// to npm's legacy v1 audit API. That endpoint 429s, returns 410, or rejects
// current lockfiles ("Invalid payload"). Fail-close on that analyzer makes
// every JS OWASP job flake. Disable Node Audit; NVD + RetireJS still run.
// Fixture/packaging trees stay excluded so RetireJS does not scan them.

const workflowsDir = fileURLToPath(new URL('.', import.meta.url));

function readWorkflow(name) {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}

const owaspWorkflows = readdirSync(workflowsDir)
  .filter((name) => /^analysis-.*\.yml$/.test(name))
  .filter((name) => readWorkflow(name).includes('Dependency-Check_Action'))
  .sort();

assert.ok(owaspWorkflows.length > 0, 'expected analysis workflows that run OWASP Dependency-Check');

const jsOwaspWorkflows = owaspWorkflows.filter((name) => !/--disableNodeJS\b/.test(readWorkflow(name)));

assert.ok(jsOwaspWorkflows.length > 0, 'expected JS-family OWASP analysis workflows');

for (const name of owaspWorkflows) {
  test(`${name} disables the legacy Node Audit analyzer`, () => {
    assert.match(
      readWorkflow(name),
      /--disableNodeAudit\b/,
      `${name} must pass --disableNodeAudit; npm's v1 audit API is not a reliable fail-close gate`,
    );
  });
}

const requiredExcludes = [
  "--exclude '**/host-fixtures/**'",
  "--exclude '**/node_modules/**'",
  "--exclude '**/packaging/**'",
];

for (const name of jsOwaspWorkflows) {
  test(`${name} excludes fixture and packaging trees from OWASP`, () => {
    const workflow = readWorkflow(name);
    for (const flag of requiredExcludes) {
      assert.ok(
        workflow.includes(flag),
        `${name} must pass ${flag} so RetireJS/NVD do not scan non-product lockfiles`,
      );
    }
  });
}
