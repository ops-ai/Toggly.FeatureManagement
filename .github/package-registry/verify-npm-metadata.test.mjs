import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceIndex,
  discoverPublicOpsAiManifests,
  loadInventory,
  validateIntraRepoDependencies,
  verifyNpmMetadata,
} from './verify-npm-metadata.mjs';

// Two packages in one workspace, one in another, mirroring the Next/Nuxt split.
const WORKSPACE_INDEX = new Map([
  ['@ops-ai/nextjs-toggly-server', 'Toggly.FeatureManagement.Next'],
  ['@ops-ai/nextjs-toggly-core', 'Toggly.FeatureManagement.Next'],
  ['@ops-ai/toggly-hooks-types', 'Toggly.FeatureManagement.Shared'],
]);

function check(data) {
  return validateIntraRepoDependencies(
    { name: '@ops-ai/nextjs-toggly-server', data },
    WORKSPACE_INDEX,
  );
}

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

test('every shipped repo package depends on siblings with a dedupe-safe range', () => {
  const discovered = discoverPublicOpsAiManifests();
  const workspaceIndex = buildWorkspaceIndex(discovered);
  const bad = discovered.flatMap((pkg) =>
    validateIntraRepoDependencies(pkg, workspaceIndex).map(
      (error) => `${pkg.name} ${error}`,
    ),
  );

  assert.deepEqual(bad, [], bad.length ? bad.join('\n') : undefined);
});

test('same-workspace runtime deps must use workspace:^', () => {
  assert.deepEqual(
    check({
      dependencies: { '@ops-ai/nextjs-toggly-core': 'workspace:^' },
      optionalDependencies: { '@ops-ai/nextjs-toggly-core': 'workspace:^' },
    }),
    [],
  );
});

test('same-workspace runtime deps reject every exact-pinning specifier', () => {
  for (const specifier of [
    'workspace:*',
    'workspace:~',
    'workspace:1.2.3',
    'file:../nextjs-toggly-core',
    'link:../nextjs-toggly-core',
    // The published shape of workspace:* — the defect OPS-820 fixed.
    '1.5.3',
    '^1.5.3',
    '*',
    '>=1.0.0',
  ]) {
    const errors = check({ dependencies: { '@ops-ai/nextjs-toggly-core': specifier } });

    assert.equal(errors.length, 1, `expected ${specifier} to be rejected`);
    assert.match(errors[0], /must use workspace:\^/);
  }
});

test('cross-workspace and peer deps accept caret ranges but reject exact pins', () => {
  assert.deepEqual(
    check({
      dependencies: { '@ops-ai/toggly-hooks-types': '^1.4.3' },
      peerDependencies: { '@ops-ai/nextjs-toggly-core': '^1.5.0' },
    }),
    [],
  );

  for (const specifier of ['1.4.3', '*', '>=1.0.0', 'workspace:*']) {
    const errors = check({ dependencies: { '@ops-ai/toggly-hooks-types': specifier } });

    assert.equal(errors.length, 1, `expected ${specifier} to be rejected`);
    assert.match(errors[0], /caret range/);
  }
});

test('the caret range must match end to end', () => {
  // An unanchored pattern would accept trailing junk, or a second comparator
  // that pins the dependency right back down.
  for (const specifier of [
    '^1.4.3 garbage',
    '^1.4.3 || 1.0.0',
    '^1.4.3.4',
    '^1.4.3-',
    '^1.4.3-..', // Empty prerelease identifier.
    '^01.4.3', // Leading zero.
    '^1.4.3+', // Empty build metadata.
  ]) {
    const errors = check({ dependencies: { '@ops-ai/toggly-hooks-types': specifier } });

    assert.equal(errors.length, 1, `expected ${specifier} to be rejected`);
  }

  // Prerelease and build metadata are still legitimate caret ranges.
  for (const specifier of ['^1.4.3-beta.1', '^1.4.3+build.5', '^0.0.1', '^1.4.3-rc.0+a']) {
    assert.deepEqual(
      check({ dependencies: { '@ops-ai/toggly-hooks-types': specifier } }),
      [],
      `expected ${specifier} to be accepted`,
    );
  }
});

test('third-party dependencies are ignored by the intra-repo guard', () => {
  assert.deepEqual(check({ dependencies: { ws: '8.18.0', react: '*' } }), []);
});
