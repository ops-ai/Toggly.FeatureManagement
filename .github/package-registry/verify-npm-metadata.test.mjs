import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverPublicOpsAiManifests,
  loadInventory,
  validateIntraRepoDependencies,
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

test('every shipped @ops-ai manifest pins intra-repo deps with workspace:^', () => {
  const bad = discoverPublicOpsAiManifests().flatMap((pkg) =>
    validateIntraRepoDependencies(pkg.name, pkg.data).map(
      (error) => `${pkg.name} ${error}`,
    ),
  );

  assert.deepEqual(bad, [], bad.length ? bad.join('\n') : undefined);
});

test('workspace:^ and published semver ranges are accepted for intra-repo deps', () => {
  const errors = validateIntraRepoDependencies('@ops-ai/example', {
    dependencies: { '@ops-ai/nuxt-toggly-core': 'workspace:^' },
    peerDependencies: { '@ops-ai/nuxt-toggly-core': '^1.6.0' },
    optionalDependencies: { '@ops-ai/nextjs-toggly-core': 'workspace:^' },
  });

  assert.deepEqual(errors, []);
});

test('exact-pinning specifiers are rejected for intra-repo deps', () => {
  for (const specifier of [
    'workspace:*',
    'workspace:~',
    'workspace:1.2.3',
    'file:../nuxt-toggly-core',
    'link:../nuxt-toggly-core',
  ]) {
    const errors = validateIntraRepoDependencies('@ops-ai/example', {
      dependencies: { '@ops-ai/nuxt-toggly-core': specifier },
    });

    assert.equal(errors.length, 1, `expected ${specifier} to be rejected`);
    assert.match(errors[0], /must use workspace:\^/);
  }
});

test('third-party dependencies are ignored by the intra-repo guard', () => {
  const errors = validateIntraRepoDependencies('@ops-ai/example', {
    dependencies: { ws: 'workspace:*', vue: '^3.0.0' },
  });

  assert.deepEqual(errors, []);
});
