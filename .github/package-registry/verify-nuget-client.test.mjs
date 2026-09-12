import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInventory, parseReleaseWorkflowProjects, verifyPackedNupkgs } from './verify-nuget-metadata.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inventory = loadInventory();
const family = inventory.families.find(f => f.name === 'distributed-client');
test('client packages have manifest versions, changelog and release inventory', () => {
  assert.ok(family);
  assert.deepEqual(family.packages.map(p => p.id), ['Toggly.FeatureManagement.Client', 'Toggly.FeatureManagement.Client.Desktop']);
  const workflow = fs.readFileSync(path.join(root, family.workflow), 'utf8');
  assert.deepEqual(parseReleaseWorkflowProjects(workflow), family.packages.map(p => p.id));
  assert.match(workflow, /release_mode: publish/);
  assert.match(workflow, /NuGet\/login@v1/);
  assert.match(workflow, /NuGetKeyVaultSignTool sign .*\.snupkg/);
  assert.match(workflow, /--collect:"XPlat Code Coverage"/);
  assert.ok(fs.existsSync(path.join(root, family.changelog)));
  const shared = fs.readFileSync(path.join(root, family.sdkRoot, 'Directory.Build.props'), 'utf8');
  assert.match(shared, /Import Project="..\/Toggly.FeatureManagement.NET\/Directory.Build.props"/);
  for (const pkg of family.packages) {
    const project = fs.readFileSync(path.join(root, family.sdkRoot, pkg.project), 'utf8');
    assert.match(project, /<Version>\d+\.\d+\.\d+(?:-[^<]+)?<\/Version>/);
    assert.match(project, /<TargetFramework>net8\.0<\/TargetFramework>/);
    assert.doesNotMatch(project, /Microsoft.AspNetCore/);
  }
});
test('client packed artifacts meet existing NuGet metadata contract', () => {
  if (!process.env.NUGET_CLIENT_PACK_DIR) return;
  const result = verifyPackedNupkgs({ inventory: {...inventory, ...family}, packDir: process.env.NUGET_CLIENT_PACK_DIR });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.foundIds.length, 2);
});
