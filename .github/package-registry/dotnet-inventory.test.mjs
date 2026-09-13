import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenPackages,
  selectPackages,
  orderPackages,
} from "./dotnet-inventory.mjs";

const inventory = {
  sdkRoot: "server",
  changelog: "server/CHANGELOG.md",
  packages: [{ id: "Core", project: "Core/Core.csproj" }],
  families: [
    {
      name: "client",
      sdkRoot: "client",
      changelog: "client/CHANGELOG.md",
      packages: [
        {
          id: "Desktop",
          project: "src/Desktop/Desktop.csproj",
          dependencies: ["Client"],
        },
        { id: "Client", project: "src/Client/Client.csproj" },
      ],
    },
  ],
};

test("different source roots use the same version manifest", () => {
  const packages = flattenPackages(inventory);
  assert.deepEqual(
    packages.map((p) => [p.id, p.projectPath, p.manifest]),
    [
      ["Core", "server/Core/Core.csproj", "server/Directory.Build.props"],
      [
        "Desktop",
        "client/src/Desktop/Desktop.csproj",
        "server/Directory.Build.props",
      ],
      [
        "Client",
        "client/src/Client/Client.csproj",
        "server/Directory.Build.props",
      ],
    ],
  );
});
test("selection uses exact package or family names, rejects typos, and includes dependencies", () => {
  const packages = flattenPackages(inventory);
  assert.deepEqual(
    selectPackages(packages, "Desktop").map((p) => p.id),
    ["Client", "Desktop"],
  );
  assert.deepEqual(
    selectPackages(packages, "server").map((p) => p.id),
    ["Core"],
  );
  assert.throws(() => selectPackages(packages, "Clie"), /Unknown/);
});
test("cycles and missing dependencies stop publication before work starts", () => {
  assert.throws(
    () => orderPackages([{ id: "A", dependencies: ["B"] }]),
    /Missing/,
  );
  assert.throws(
    () =>
      orderPackages([
        { id: "A", dependencies: ["B"] },
        { id: "B", dependencies: ["A"] },
      ]),
    /cycle/,
  );
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  families,
  loadDotnetInventory,
  validateSources,
  repoRoot,
} from "./dotnet-inventory.mjs";
import { readCommonVersion, verifyPackageVersions } from "./dotnet-version.mjs";
import { verifyPackedNupkgs } from "./verify-nuget-metadata.mjs";

test("declared missing projects and newly added package omissions fail source validation", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dotnet-inventory-test-"),
  );
  const sample = {
    sdkRoot: "Toggly.Core",
    changelog: "Toggly.Core/CHANGELOG.md",
    packages: [{ id: "Core", project: "Core/Core.csproj" }],
  };
  try {
    assert.throws(
      () => validateSources(sample, directory),
      /Missing declared source/,
    );
    fs.mkdirSync(path.join(directory, "Toggly.Core/Core"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "Toggly.Core/Core/Core.csproj"),
      "<Project />",
    );
    fs.writeFileSync(
      path.join(directory, "Toggly.Core/Directory.Build.props"),
      "<Project />",
    );
    fs.writeFileSync(
      path.join(directory, "Toggly.Core/CHANGELOG.md"),
      "# Changes",
    );
    assert.equal(validateSources(sample, directory).length, 1);
    fs.writeFileSync(
      path.join(directory, "Toggly.Core/Core/New.csproj"),
      "<Project />",
    );
    assert.throws(
      () => validateSources(sample, directory),
      /missing from NuGet inventory/,
    );
    fs.rmSync(path.join(directory, "Toggly.Core/Core/New.csproj"));
    fs.writeFileSync(
      path.join(directory, "Toggly.Core/Core/Core.csproj"),
      "<Project><PropertyGroup><Version>0.1.0</Version></PropertyGroup></Project>",
    );
    assert.throws(
      () => validateSources(sample, directory),
      /Independent version override/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("all declared current families validate and optional artifacts contain metadata and symbols", () => {
  const current = loadDotnetInventory();
  const packages = validateSources(current, repoRoot);
  assert.ok(packages.length > 0);
  if (!process.env.NUGET_ALL_PACK_DIR) {
    return;
  }

  verifyPackageVersions(
    packages,
    process.env.NUGET_ALL_PACK_DIR,
    readCommonVersion(path.join(repoRoot, packages[0].manifest)),
  );

  for (const family of families(current)) {
    const result = verifyPackedNupkgs({
      inventory: { ...current, ...family },
      packDir: process.env.NUGET_ALL_PACK_DIR,
    });
    assert.equal(result.ok, true, result.errors.join("\n"));
    const artifacts = fs.readdirSync(process.env.NUGET_ALL_PACK_DIR);
    for (const pkg of family.packages) {
      assert.ok(
        artifacts.some(
          (file) => file.startsWith(`${pkg.id}.`) && file.endsWith(".snupkg"),
        ),
        `Missing symbols for ${pkg.id}`,
      );
    }
  }
});

test("every SDK package inherits the common version without project overrides", () => {
  const current = loadDotnetInventory();
  const packages = validateSources(current);
  assert.equal(new Set(packages.map((pkg) => pkg.manifest)).size, 1);
  for (const pkg of packages) {
    const source = fs.readFileSync(
      path.join(repoRoot, pkg.projectPath),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /<(?:Version|VersionPrefix|PackageVersion)\b/,
      pkg.id,
    );
  }
});
