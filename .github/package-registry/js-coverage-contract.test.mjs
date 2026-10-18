import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { FULL_TEST_MATRIX } from './analysis-js-filter.mjs';
import {
  SDK_PATHS,
  assertSdkPathsExistOnDisk,
  listRequiredCoverageSdks,
} from '../scripts/js-coverage-manifest.mjs';
import { REQUIRED_COVERAGE_SDKS } from '../scripts/organize-js-coverage.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const NODE_COVERAGE_SDKS = ['Node-Core', 'Node-Express', 'Node-Fastify', 'Node-Hono', 'Node-Koa'];

const COVERAGE_PRODUCED_OUTSIDE_MATRIX = new Set([
  'Signed-Defs',
  'Docusaurus-Pages',
  ...NODE_COVERAGE_SDKS,
]);

test('every analysis matrix SDK has a coverage manifest entry', () => {
  for (const row of FULL_TEST_MATRIX) {
    assert.ok(Object.hasOwn(SDK_PATHS, row.sdk), `matrix SDK ${row.sdk} missing from SDK_PATHS`);
  }
});

test('required coverage SDKs are exactly the manifest keys', () => {
  assert.deepEqual(REQUIRED_COVERAGE_SDKS, listRequiredCoverageSdks());
  assert.ok(REQUIRED_COVERAGE_SDKS.includes('Local-Gates'));
  assert.ok(REQUIRED_COVERAGE_SDKS.includes('Docusaurus'));
});

test('SDK_PATHS entries resolve to existing package directories', () => {
  assertSdkPathsExistOnDisk();
});

test('non-matrix coverage producers are still declared in the manifest', () => {
  for (const sdk of COVERAGE_PRODUCED_OUTSIDE_MATRIX) {
    assert.ok(Object.hasOwn(SDK_PATHS, sdk), `${sdk} must be in SDK_PATHS`);
  }
});

test('new matrix SDKs cannot land without a manifest mapping', () => {
  const matrixSdks = new Set(FULL_TEST_MATRIX.map((row) => row.sdk));
  const manifestSdks = new Set(Object.keys(SDK_PATHS));
  const onlyInManifest = [...manifestSdks].filter((sdk) => !matrixSdks.has(sdk));
  const expectedExtras = [...COVERAGE_PRODUCED_OUTSIDE_MATRIX].sort();
  assert.deepEqual(onlyInManifest.sort(), expectedExtras);
});

test('Docusaurus plugin is exercised in the dedicated host workflow', () => {
  const workflow = fs.readFileSync(
    path.join(repositoryRoot, '.github/workflows/analysis-javascript.yml'),
    'utf8',
  );
  assert.match(workflow, /test:coverage/);
  assert.match(workflow, /name: coverage-Docusaurus/);
});
