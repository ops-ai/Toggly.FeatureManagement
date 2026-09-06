import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInventory } from './verify-nuget-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SDK_ROOT = path.join(REPO_ROOT, 'Toggly.FeatureManagement.NET');
const DIRECTORY_BUILD_PROPS = path.join(SDK_ROOT, 'Directory.Build.props');
const TF_BUILD_CONDITION = "Condition=\"'$(TF_BUILD)' == 'true'\"";

test('Directory.Build.props enables ContinuousIntegrationBuild on GITHUB_ACTIONS', () => {
  const props = fs.readFileSync(DIRECTORY_BUILD_PROPS, 'utf8');
  assert.match(props, /GITHUB_ACTIONS/);
  assert.match(props, /ContinuousIntegrationBuild/);
  assert.match(
    props,
    /Condition="'\$\(TF_BUILD\)' == 'true' Or '\$\(GITHUB_ACTIONS\)' == 'true'"/,
  );
});

test('packable csproj files do not duplicate TF_BUILD ContinuousIntegrationBuild', () => {
  const inventory = loadInventory();
  const offenders = [];

  for (const pkg of inventory.packages) {
    const csprojPath = path.join(SDK_ROOT, pkg.project);
    const text = fs.readFileSync(csprojPath, 'utf8');
    if (text.includes(TF_BUILD_CONDITION)) {
      offenders.push(pkg.project);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `packable csproj still contain TF_BUILD PropertyGroup: ${offenders.join(', ')}`,
  );
});
