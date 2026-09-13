import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReleases } from "./dotnet-create-releases.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dotnet-release-retry-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const release = {
    tag: "dotnet-sdk-v1.2.3",
    marker: "<!-- sibling-batch -->",
    notes: path.join(directory, "notes.md"),
    assets: ["SHA256SUMS-second", "SHA256SUMS-second.asc"],
  };
  fs.writeFileSync(release.notes, `${release.marker}\n- Sibling 1.2.3`);
  return { directory, release };
}

test("later sibling preserves existing tag, notes and assets while adding its own evidence", (t) => {
  const { directory, release } = fixture(t);
  const calls = [];
  const run = (binary, args) => {
    calls.push([binary, ...args]);
    if (args[0] === "ls-remote") {
      return "older-sha refs/tags/dotnet-sdk-v1.2.3";
    }

    if (args[0] === "api") {
      return JSON.stringify([
        [
          {
            tag_name: release.tag,
            body: "First package evidence",
            assets: [{ name: "SHA256SUMS-first" }],
          },
        ],
      ]);
    }

    return "";
  };
  createReleases([release], directory, run);
  assert.equal(calls.filter((call) => call[0] === "git").length, 1);
  assert.equal(
    calls.filter((call) => call[1] === "release" && call[2] === "upload")
      .length,
    2,
  );
  assert.equal(
    calls.some((call) => call.includes("--clobber")),
    false,
  );
  const combined = fs.readFileSync(
    path.join(directory, `${release.tag}-combined.md`),
    "utf8",
  );
  assert.match(combined, /First package evidence/);
  assert.match(combined, /Sibling 1.2.3/);
});

test("retry after partial asset upload fills only missing evidence without duplicate notes", (t) => {
  const { directory, release } = fixture(t);
  const calls = [];
  const run = (binary, args) => {
    calls.push([binary, ...args]);
    if (args[0] === "ls-remote") {
      return "existing-tag";
    }

    if (args[0] === "api") {
      return JSON.stringify([
        [
          {
            tag_name: release.tag,
            body: release.marker,
            assets: [{ name: release.assets[0] }],
          },
        ],
      ]);
    }

    return "";
  };
  createReleases([release], directory, run);
  assert.equal(calls.filter((call) => call[2] === "upload").length, 1);
  assert.equal(
    calls.some((call) => call[2] === "edit" || call[2] === "create"),
    false,
  );
});

test("retry after signed tag push creates the missing release without moving the tag", (t) => {
  const { directory, release } = fixture(t);
  const calls = [];
  const run = (binary, args) => {
    calls.push([binary, ...args]);
    if (args[0] === "ls-remote") {
      return "existing-tag";
    }

    if (args[0] === "api") {
      return "[[]]";
    }

    return "";
  };
  createReleases([release], directory, run, true);
  assert.equal(calls.filter((call) => call[0] === "git").length, 1);
  assert.ok(
    calls.find((call) => call[2] === "create").includes("--verify-tag"),
  );
  assert.ok(
    calls.find((call) => call[2] === "create").includes("--prerelease"),
  );
});
