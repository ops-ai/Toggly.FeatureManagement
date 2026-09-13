import fs from "node:fs";
import { spawnSync } from "node:child_process";

const packages = new Map([
  ["core", "toggly-node-core"],
  ["express", "toggly-express"],
  ["fastify", "toggly-fastify"],
  ["hono", "toggly-hono"],
  ["koa", "toggly-koa"],
]);

try {
  const selection = process.env.RELEASE_PACKAGES?.trim() ?? "";
  const selectors =
    selection === "all"
      ? [...packages.keys()]
      : selection.split(",").map((value) => value.trim());
  if (selectors.some((selector) => !packages.has(selector))) {
    throw new Error(
      "Expected all or comma-separated packages: core,express,fastify,hono,koa",
    );
  }
  // Keep the caller's publication order, removing duplicate selectors only.
  const selected = [...new Set(selectors)].map((selector) =>
    packages.get(selector),
  );
  if (process.argv[2] === "matrix") {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify(selected)}\n`,
    );
    console.log(`Publishing packages: ${selected.join(", ")}`);
  } else if (process.argv[2] === "test") {
    // pnpm's trailing ... includes workspace dependencies, not dependents.
    // A core release must not need unselected adapter consumers published first.
    const filters =
      selection === "all"
        ? []
        : selected.flatMap((name) => ["--filter", `@ops-ai/${name}...`]);
    const result = spawnSync("pnpm", ["-r", ...filters, "test"], {
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else {
    throw new Error("Expected command: matrix or test");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
