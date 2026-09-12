import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sealSignedCandidate } from "./dotnet-signed-candidate.mjs";
import { publishPackages } from "./dotnet-publish.mjs";

test("registry pushes use dependency order and require symbols for the complete candidate", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dotnet-publish-test-"),
  );
  const plan = {
    packages: [
      {
        id: "Desktop",
        version: "0.2.0",
        action: "publish",
        dependencies: ["Client"],
      },
      { id: "Client", version: "0.1.0", action: "publish", dependencies: [] },
      { id: "Core", version: "3.6.6", action: "skip", dependencies: [] },
    ],
  };
  try {
    fs.mkdirSync(path.join(directory, "nupkgs"));
    for (const name of [
      "Client.0.1.0.nupkg",
      "Client.0.1.0.snupkg",
      "Desktop.0.2.0.nupkg",
    ])
      fs.writeFileSync(path.join(directory, "nupkgs", name), "test artifact");
    const pushed = [];
    await assert.rejects(
      publishPackages(plan, directory, (file) =>
        pushed.push(path.basename(file)),
      ),
      /Missing signed artifact/,
    );
    assert.deepEqual(pushed, []);
    fs.writeFileSync(
      path.join(directory, "nupkgs/Desktop.0.2.0.snupkg"),
      "test symbols",
    );
    sealSignedCandidate(directory);
    await publishPackages(plan, directory, (file) =>
      pushed.push(path.basename(file)),
    );
    assert.deepEqual(pushed, [
      "Client.0.1.0.nupkg",
      "Client.0.1.0.snupkg",
      "Desktop.0.2.0.nupkg",
      "Desktop.0.2.0.snupkg",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
