import test from "node:test";
import assert from "node:assert/strict";
import { createReleasePlan } from "./dotnet-release-plan.mjs";
const packages = [
  { id: "Core", family: "server", manifest: "server/Directory.Build.props" },
  { id: "Client", family: "client", manifest: "client/Client.csproj" },
];
test("an equal server version cannot hide an unpublished client with a different version", async () => {
  const plan = await createReleasePlan(packages, {
    resolve: (pkg) =>
      pkg.id === "Core"
        ? { version: "3.6.6", action: "skip" }
        : { version: "0.1.0", action: "publish" },
  });
  assert.deepEqual(
    plan.packages.map((pkg) => [pkg.id, pkg.version, pkg.action]),
    [
      ["Core", "3.6.6", "skip"],
      ["Client", "0.1.0", "publish"],
    ],
  );
});
test("legacy bump changes only the server manifest while selected clients stay manifest driven", async () => {
  const calls = [];
  const plan = await createReleasePlan(packages, {
    releaseMode: "auto_bump",
    bumpType: "minor",
    resolve: (pkg, mode, bump) => {
      calls.push([pkg.id, mode, bump]);
      return {
        version: pkg.id === "Core" ? "3.7.0" : "0.1.0",
        action: "publish",
        manifest_changed: pkg.id === "Core" ? "true" : "false",
      };
    },
  });
  assert.deepEqual(calls, [
    ["Core", "auto_bump", "minor"],
    ["Client", "publish", "minor"],
  ]);
  assert.equal(plan.manifestChanged, true);
  assert.equal(plan.serverManifest, "server/Directory.Build.props");
});
test("invalid selections and failed registry resolution stop a release", async () => {
  await assert.rejects(
    createReleasePlan([packages[1]], { releaseMode: "auto_bump" }),
    /requires selected server/,
  );
  await assert.rejects(
    createReleasePlan(packages, {
      resolve: () => ({ action: "fail", reason: "behind registry" }),
    }),
    /behind registry/,
  );
});
