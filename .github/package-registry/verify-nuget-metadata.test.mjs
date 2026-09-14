import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadInventory,
  parseReleaseWorkflowProjects,
  projectFolder,
  verifyNugetInventory,
  verifyNugetMetadata,
  verifyPackedNupkgs,
} from './verify-nuget-metadata.mjs';

test('inventory lists unique NuGet package ids including embedded packages', () => {
  const inventory = loadInventory();
  const ids = inventory.packages.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const suffix of ['Catalog', 'Embedded', 'Dashboard']) {
    assert.ok(ids.includes(`Toggly.FeatureManagement.${suffix}`));
  }
});

test('inventory projects exist and release workflow folders match', () => {
  const result = verifyNugetInventory();
  assert.equal(
    result.ok,
    true,
    result.errors.length ? result.errors.join('\n') : 'unexpected failure',
  );
});

test('source validation follows a changed inventory and still rejects omissions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-inventory-'));
  const inventory = { sdkRoot: 'server', workflow: 'release.yml', packages: [
    { id: 'Example.Core', project: 'Core/Core.csproj' },
  ] };
  try {
    fs.mkdirSync(path.join(directory, 'server/Core'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'server/assets'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'server/Core/Core.csproj'), '<Project />');
    fs.writeFileSync(path.join(directory, 'server/assets/toggly-package-icon.png'), 'test icon');
    fs.writeFileSync(path.join(directory, 'release.yml'), '          - project: Core\n');
    assert.equal(verifyNugetInventory({ inventory, repoRoot: directory }).ok, true);
    fs.writeFileSync(path.join(directory, 'release.yml'), '          - project: Core\n          - project: Missing\n');
    assert.equal(verifyNugetInventory({ inventory, repoRoot: directory }).ok, false);
    const empty = verifyNugetInventory({ inventory: { ...inventory, packages: [] }, repoRoot: directory });
    assert.equal(empty.ok, false);
    assert.ok(empty.errors.includes('NuGet inventory must contain at least one package'));
    const duplicate = verifyNugetInventory({ inventory: { ...inventory, packages: [...inventory.packages, ...inventory.packages] }, repoRoot: directory });
    assert.ok(duplicate.errors.includes('duplicate package ids in inventory'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
  assert.deepEqual(result.foundIds, loadInventory().packages.map((entry) => entry.id).sort());
});
