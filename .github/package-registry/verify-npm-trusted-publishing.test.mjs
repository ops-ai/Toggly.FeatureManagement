import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNpmTrustedPublishing } from './verify-npm-trusted-publishing.mjs';
import { loadInventory } from './verify-npm-metadata.mjs';

test('oidcReady workflows have no NPM_TOKEN / NODE_AUTH_TOKEN fallback', () => {
  const result = verifyNpmTrustedPublishing();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('inventory oidcReady flags only packages that claim trusted publishing', () => {
  const inventory = loadInventory();
  const ready = inventory.packages.filter((p) => p.oidcReady);
  assert.ok(ready.length >= 1, 'expected at least one oidcReady package');
  for (const pkg of ready) {
    assert.match(pkg.workflow, /sdk-.*-release\.yml$/);
  }
});
