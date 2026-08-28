import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverPublicOpsAiManifests,
  loadInventory,
  verifyNpmMetadata,
} from './verify-npm-metadata.mjs';

test('inventory lists every discovered public @ops-ai package exactly once', () => {
  const inventory = loadInventory();
  const discovered = discoverPublicOpsAiManifests();
  const names = inventory.packages.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'duplicate inventory names');
  assert.deepEqual(
    names.slice().sort(),
    discovered.map((d) => d.name).sort(),
  );
});

test('every inventory workflow, changelog, and metadata contract passes', () => {
  const result = verifyNpmMetadata();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected failure',
  );
});
