import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractJob } from "./verify-nuget-trusted-publishing.mjs";

const workflow = fs.readFileSync(
  new URL("../workflows/sdk-dotnet-release.yml", import.meta.url),
  "utf8",
);
test("a completed immutable signing job precedes every registry publication and release retry", () => {
  const validate = extractJob(workflow, "validate");
  const sign = extractJob(workflow, "sign");
  assert.ok(
    sign,
    "Signing must complete in its own job before publication can start",
  );
  const publish = extractJob(workflow, "publish");
  const release = extractJob(workflow, "release");
  // Both uploads use fixed names within this run. Entire-workflow retries fail
  // the validation upload before signing; failed-job retries reuse completed jobs.
  assert.match(
    validate,
    /name: dotnet-release-candidate\n\s+path: release-candidate\/\n\s+overwrite: false/,
  );
  assert.match(sign, /needs: validate/);
  assert.match(
    sign,
    /name: signed-dotnet-packages\n\s+path: release-candidate\/\n\s+overwrite: false/,
  );
  assert.match(sign, /environment: nuget-publish/);
  assert.match(sign, /NuGetKeyVaultSignTool sign/);
  assert.match(sign, /name: signed-dotnet-packages/);
  assert.doesNotMatch(sign, /dotnet-publish|NuGet\/login/);
  assert.match(publish, /needs: sign/);
  for (const job of [publish, release]) {
    assert.match(job, /name: signed-dotnet-packages/);
    assert.match(job, /dotnet-signed-candidate\.mjs verify/);
    assert.doesNotMatch(
      job,
      /NuGetKeyVaultSignTool|dotnet-ci\.mjs pack|sha256sum/,
    );
  }
  assert.doesNotMatch(sign, /overwrite:\s*true/);
});

import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  sealSignedCandidate,
  verifySignedCandidate,
} from "./dotnet-signed-candidate.mjs";
import { publishPackages } from "./dotnet-publish.mjs";
import { execFileSync } from "node:child_process";
import { loadDotnetInventory, validateSources } from "./dotnet-inventory.mjs";

test("partial registry failure retries the completed signed artifact without re-signing or checksum drift", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotnet-signed-retry-"));
  const candidate = path.join(root, "signing-job");
  const uploaded = path.join(root, "immutable-upload");
  const consumer = path.join(root, "publish-job");
  const plan = {
    packages: [
      { id: "Core", version: "1.0.0", action: "publish", dependencies: [] },
    ],
  };
  let signingCalls = 0;
  const registry = new Map();
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    fs.mkdirSync(path.join(candidate, "nupkgs"), { recursive: true });
    for (const extension of ["nupkg", "snupkg"]) {
      // A fake RFC3161 signer deliberately emits distinct bytes on every invocation.
      fs.writeFileSync(
        path.join(candidate, "nupkgs", `Core.1.0.0.${extension}`),
        `signed-timestamp-${++signingCalls}`,
      );
    }
    sealSignedCandidate(candidate);
    assert.throws(() => sealSignedCandidate(candidate), /EEXIST/);
    fs.cpSync(candidate, uploaded, { recursive: true });
    const download = () => {
      fs.rmSync(consumer, { recursive: true, force: true });
      fs.cpSync(uploaded, consumer, { recursive: true });
      verifySignedCandidate(consumer);
    };
    download();
    await assert.rejects(
      publishPackages(plan, consumer, (file) => {
        if (registry.size === 1) throw new Error("Transient registry outage");
        registry.set(path.basename(file), digest(fs.readFileSync(file)));
      }),
      /Transient/,
    );
    assert.equal(registry.size, 1);

    // Re-signing downloaded bytes must be rejected before another irreversible push.
    fs.appendFileSync(
      path.join(consumer, "nupkgs/Core.1.0.0.nupkg"),
      "different timestamp",
    );
    let pushes = 0;
    await assert.rejects(
      publishPackages(plan, consumer, () => {
        pushes++;
      }),
      /checksum mismatch/,
    );
    assert.equal(pushes, 0);

    download();
    await publishPackages(plan, consumer, (file) => {
      const name = path.basename(file);
      const hash = digest(fs.readFileSync(file));
      if (registry.has(name))
        assert.equal(
          registry.get(name),
          hash,
          "skip-duplicate must refer to identical signed bytes",
        );
      else registry.set(name, hash);
    });
    assert.equal(
      signingCalls,
      2,
      "only the original package and symbol signing ran",
    );
    assert.equal(registry.size, 2);
    assert.equal(
      fs.readFileSync(path.join(consumer, "SHA256SUMS"), "utf8"),
      fs.readFileSync(path.join(uploaded, "SHA256SUMS"), "utf8"),
    );
    for (const [name, hash] of registry) {
      assert.ok(
        fs
          .readFileSync(path.join(consumer, "SHA256SUMS"), "utf8")
          .includes(`${hash}  ${name}\n`),
      );
    }
    // Release retries consume the same upload, independent of the publish workspace.
    download();
    verifySignedCandidate(consumer);
    fs.writeFileSync(
      path.join(consumer, "nupkgs/Unexpected.1.0.0.nupkg"),
      "not in signed upload",
    );
    assert.throws(() => verifySignedCandidate(consumer), /checksum mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("analysis summary lists every current inventory package exactly once", () => {
  const packages = validateSources(loadDotnetInventory());
  const summary = execFileSync(
    process.execPath,
    [new URL("./dotnet-ci.mjs", import.meta.url).pathname, "summary"],
    { encoding: "utf8" },
  );
  assert.match(
    summary,
    new RegExp(`Packages Analyzed \\(${packages.length}\\)`),
  );
  assert.deepEqual(
    summary
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2))
      .sort(),
    packages.map((pkg) => pkg.id).sort(),
  );
  const analysis = fs.readFileSync(
    new URL("../workflows/analysis-dotnet.yml", import.meta.url),
    "utf8",
  );
  assert.match(analysis, /dotnet-ci\.mjs summary/);
  assert.doesNotMatch(analysis, /echo "- Toggly\./);
});
