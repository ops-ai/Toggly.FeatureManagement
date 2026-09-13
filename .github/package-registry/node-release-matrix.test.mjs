import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const workflow = fs.readFileSync(
  new URL("../workflows/sdk-node-server-release.yml", import.meta.url),
  "utf8",
);
const block = workflow.match(/        run: \|\n([\s\S]*?)\n  build-and-test:/);
assert.ok(block, "Node release matrix step must exist");
const script = block[1]
  .replace(/^          /gm, "")
  .replace(
    "${{ github.event.inputs.packages || 'all' }}",
    "${RELEASE_PACKAGES}",
  );

for (const [selection, expected] of [
  ["core", ["toggly-node-core"]],
  ["core,hono", ["toggly-node-core", "toggly-hono"]],
  ["express,fastify,koa", ["toggly-express", "toggly-fastify", "toggly-koa"]],
  [
    "all",
    [
      "toggly-node-core",
      "toggly-express",
      "toggly-fastify",
      "toggly-hono",
      "toggly-koa",
    ],
  ],
]) {
  test(`Node release selection ${selection} produces a valid single-line matrix output`, () => {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "node-release-matrix-"),
    );
    const output = path.join(temporary, "output");

    try {
      // Execute the real workflow shell; pretty JSON breaks the runner output protocol.
      execFileSync("bash", ["-e", "-c", script], {
        env: {
          ...process.env,
          RELEASE_PACKAGES: selection,
          GITHUB_OUTPUT: output,
        },
      });
      const lines = fs.readFileSync(output, "utf8").trimEnd().split("\n");
      assert.equal(
        lines.length,
        1,
        "GITHUB_OUTPUT must contain one key=value line",
      );
      assert.ok(lines[0].startsWith("matrix="));
      assert.deepEqual(JSON.parse(lines[0].slice("matrix=".length)), expected);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
}
