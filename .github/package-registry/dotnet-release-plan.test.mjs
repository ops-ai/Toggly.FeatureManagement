import test from "node:test";
import assert from "node:assert/strict";
import { createReleasePlan } from "./dotnet-release-plan.mjs";

const manifest = "server/Directory.Build.props";
const packages = [
  { id: "Core", family: "server", manifest },
  { id: "Client", family: "client", manifest },
];

test("an equal sibling cannot hide an unpublished package at the common version", async () => {
  const plan = await createReleasePlan(packages, {
    resolve: (pkg) => ({
      version: "3.7.0",
      action: pkg.id === "Core" ? "skip" : "publish",
    }),
  });
  assert.deepEqual(
    plan.packages.map((pkg) => [pkg.id, pkg.version, pkg.action]),
    [
      ["Core", "3.7.0", "skip"],
      ["Client", "3.7.0", "publish"],
    ],
  );
});

test("legacy bump updates the common manifest once, including client-only selections", async () => {
  for (const selected of [packages, [packages[1]]]) {
    const calls = [];
    const plan = await createReleasePlan(selected, {
      releaseMode: "auto_bump",
      bumpType: "minor",
      resolve: (pkg, mode, bump) => {
        calls.push([pkg.id, mode, bump]);
        return {
          version: "3.8.0",
          action: "publish",
          manifest_changed: mode === "auto_bump" ? "true" : "false",
        };
      },
    });
    assert.deepEqual(
      calls,
      selected.map((pkg, index) => [
        pkg.id,
        index === 0 ? "auto_bump" : "publish",
        "minor",
      ]),
    );
    assert.equal(plan.manifestChanged, true);
    assert.equal(plan.versionManifest, manifest);
    assert.equal(plan.version, "3.8.0");
  }
});

test("split manifests and mismatched resolved versions fail before publication", async () => {
  await assert.rejects(
    createReleasePlan([
      packages[0],
      { ...packages[1], manifest: "client/Client.csproj" },
    ]),
    /common manifest/,
  );
  await assert.rejects(
    createReleasePlan(packages, {
      resolve: (pkg) => ({
        action: "publish",
        version: pkg.id === "Core" ? "3.7.0" : "0.1.0",
      }),
    }),
    /Version mismatch/,
  );
});

test("empty selections, unknown modes and behind-registry decisions stop a release", async () => {
  await assert.rejects(createReleasePlan([]), /No packages/);
  await assert.rejects(
    createReleasePlan(packages, { releaseMode: "other" }),
    /Unknown release mode/,
  );
  await assert.rejects(
    createReleasePlan(packages, {
      resolve: () => ({ action: "fail", reason: "behind registry" }),
    }),
    /behind registry/,
  );
});
