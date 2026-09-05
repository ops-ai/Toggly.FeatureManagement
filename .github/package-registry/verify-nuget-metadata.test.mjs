import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadInventory,
  parseReleaseWorkflowProjects,
  projectFolder,
  verifyNugetInventory,
  verifyNugetMetadata,
  verifyPackedNupkgs,
} from './verify-nuget-metadata.mjs';

test('inventory lists exactly eleven unique NuGet package ids', () => {
  const inventory = loadInventory();
  const ids = inventory.packages.map((p) => p.id);
  assert.equal(ids.length, 11);
  assert.equal(new Set(ids).size, 11);
});

test('inventory projects exist and release workflow folders match', () => {
  const result = verifyNugetInventory();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('workflow project folders map to inventory PackageIds', () => {
  const inventory = loadInventory();
  const folderToId = new Map(
    inventory.packages.map((p) => [projectFolder(p.project), p.id]),
  );
  assert.equal(folderToId.get('Toggly.Storage.MongoDB'), 'Toggly.FeatureManagement.Storage.MongoDB');
  assert.equal(folderToId.get('Toggly.Storage.Dapper'), 'Toggly.FeatureManagement.Storage.Dapper');
  assert.equal(
    folderToId.get('Toggly.Storage.EntityFramework'),
    'Toggly.FeatureManagement.Storage.EntityFramework',
  );
  assert.equal(folderToId.get('Toggly.FeatureManagement'), 'Toggly.FeatureManagement');
});

test('parseReleaseWorkflowProjects extracts matrix project folders', () => {
  const sample = `
      matrix:
        include:
          - project: Toggly.FeatureManagement
            name: Core
          - project: Toggly.Storage.MongoDB
            name: Storage.MongoDB
`;
  assert.deepEqual(parseReleaseWorkflowProjects(sample), [
    'Toggly.FeatureManagement',
    'Toggly.Storage.MongoDB',
  ]);
});

test('full metadata contract passes (inventory always; pack when NUGET_PACK_DIR set)', () => {
  const result = verifyNugetMetadata();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('packed nupkg contract runs when NUGET_PACK_DIR is set', () => {
  if (!process.env.NUGET_PACK_DIR) {
    // Inventory-only CI path; pack assertions run in local/release verification.
    assert.equal(verifyPackedNupkgs().skipped, true);
    return;
  }
  const result = verifyPackedNupkgs();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected pack failure',
  );
  assert.equal(result.foundIds.length, 11);
});
