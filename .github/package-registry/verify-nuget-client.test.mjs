import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadInventory,
  parseReleaseWorkflowProjects,
  verifyPackedNupkgs,
} from "./verify-nuget-metadata.mjs";
import { flattenPackages, selectPackages } from "./dotnet-inventory.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const inventory = loadInventory();
const family = inventory.families.find((f) => f.name === "distributed-client");
test("client packages have manifest versions, changelog and release inventory", () => {
  assert.ok(family);
  assert.deepEqual(
    family.packages.map((p) => p.id),
    [
      "Toggly.FeatureManagement.Client",
      "Toggly.FeatureManagement.Client.Desktop",
    ],
  );
  const workflow = fs.readFileSync(path.join(root, family.workflow), "utf8");
  assert.deepEqual(
    selectPackages(flattenPackages(inventory), family.name).map((p) => p.id),
    family.packages.map((p) => p.id),
  );
  assert.match(workflow, /default: publish/);
  assert.match(workflow, /NuGet\/login@[0-9a-f]{40}/);
  assert.match(workflow, /NuGetKeyVaultSignTool sign/);
  assert.match(workflow, /\*\.snupkg/);
  assert.match(workflow, /dotnet-ci\.mjs test/);
  assert.ok(fs.existsSync(path.join(root, family.changelog)));
  const shared = fs.readFileSync(
    path.join(root, family.sdkRoot, "Directory.Build.props"),
    "utf8",
  );
  assert.match(
    shared,
    /Import Project="..\/Toggly.FeatureManagement.NET\/Directory.Build.props"/,
  );
  for (const pkg of family.packages) {
    const project = fs.readFileSync(
      path.join(root, family.sdkRoot, pkg.project),
      "utf8",
    );
    assert.match(project, /<Version>\d+\.\d+\.\d+(?:-[^<]+)?<\/Version>/);
    assert.match(project, /<TargetFramework>net8\.0<\/TargetFramework>/);
    assert.doesNotMatch(project, /Microsoft.AspNetCore/);
  }
});
test("client packed artifacts meet existing NuGet metadata contract", () => {
  if (!process.env.NUGET_CLIENT_PACK_DIR) return;
  const result = verifyPackedNupkgs({
    inventory: { ...inventory, ...family },
    packDir: process.env.NUGET_CLIENT_PACK_DIR,
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.foundIds.length, 2);
});

test("client release and analysis pin external actions and protect shell secrets", () => {
  for (const name of ["sdk-dotnet-release.yml", "analysis-dotnet.yml"]) {
    const workflow = fs.readFileSync(
      path.join(root, ".github/workflows", name),
      "utf8",
    );
    for (const match of workflow.matchAll(/uses:\s+(?!\.\/)([^\s#]+)/g)) {
      assert.match(match[1], /@[0-9a-f]{40}$/, `Unpinned action: ${match[1]}`);
    }
    assert.doesNotMatch(workflow, /http:\/\/timestamp/);
    assert.doesNotMatch(
      workflow,
      /(?:echo|--api-key).*\$\{\{\s*(?:secrets\.|steps\.nuget_login\.outputs)/,
    );
  }
  const analysis = fs.readFileSync(
    path.join(root, ".github/workflows/analysis-dotnet.yml"),
    "utf8",
  );
  assert.match(analysis, /path: 'Toggly.FeatureManagement.NET'/);
  assert.match(analysis, /dotnet-ci\.mjs scan-args/);
});
