import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadInventory, verifyPackedNupkgs } from "./verify-nuget-metadata.mjs";
import { validateSources, selectPackages } from "./dotnet-inventory.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const inventory = loadInventory();
const family = inventory.families.find((f) => f.name === "blazor");
test("Blazor packages have manifest versions, changelog and release inventory", () => {
  assert.ok(family);
  assert.deepEqual(
    family.packages.map((p) => p.id),
    [
      "Toggly.FeatureManagement.Blazor",
      "Toggly.FeatureManagement.Blazor.Server",
    ],
  );
  const workflow = fs.readFileSync(path.join(root, family.workflow), "utf8");
  assert.equal(family.workflow, ".github/workflows/sdk-dotnet-release.yml");
  const packages = validateSources(inventory);
  const selected = selectPackages(packages, "blazor").map((pkg) => pkg.id);
  assert.ok(selected.includes("Toggly.FeatureManagement.Blazor"));
  assert.ok(selected.includes("Toggly.FeatureManagement.Blazor.Server"));
  assert.ok(
    selected.indexOf("Toggly.FeatureManagement.Blazor") <
      selected.indexOf("Toggly.FeatureManagement.Blazor.Server"),
  );
  assert.equal(
    family.browserTests,
    "Toggly.FeatureManagement.Blazor/test-browser.sh",
  );
  assert.match(workflow, /default: publish/);
  assert.match(workflow, /NuGet\/login@[a-f0-9]{40} # v1/);
  assert.match(workflow, /NuGetKeyVaultSignTool sign "\$artifact"/);
  assert.match(workflow, /dotnet-ci\.mjs test/);
  const commands = fs.readFileSync(
    path.join(root, ".github/package-registry/dotnet-ci.mjs"),
    "utf8",
  );
  assert.match(commands, /XPlat Code Coverage/);
  assert.match(commands, /family\.browserTests/);
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
    if (pkg.id === "Toggly.FeatureManagement.Blazor")
      assert.doesNotMatch(
        project,
        /Toggly.FeatureManagement\" Version=|Client.Desktop|FrameworkReference/,
      );
  }
});
test("Blazor packed artifacts meet existing NuGet metadata contract", () => {
  if (!process.env.NUGET_BLAZOR_PACK_DIR) return;
  const result = verifyPackedNupkgs({
    inventory: { ...inventory, ...family },
    packDir: process.env.NUGET_BLAZOR_PACK_DIR,
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.foundIds.length, 2);
});
