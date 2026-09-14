import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const lcovPath = resolve(here, "../../Toggly.FeatureManagement.Dashboard/coverage/lcov.info");
const source = resolve(here, "../../Toggly.FeatureManagement.Dashboard/Assets/dashboard.js");
const mapped = relative(repoRoot, source);
const rewritten = readFileSync(lcovPath, "utf8").replace(/^SF:.*$/m, `SF:${mapped}`);
writeFileSync(lcovPath, rewritten);
