import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lcovPath = resolve(here, "../../Toggly.FeatureManagement.Dashboard/coverage/lcov.info");
const source = resolve(here, "../../Toggly.FeatureManagement.Dashboard/Assets/dashboard.js");
if (!isAbsolute(source)) throw new Error(`Expected an absolute coverage path, got ${source}`);
// SonarScanner for .NET resolves LCOV from each MSBuild module directory, not
// the repo root. Repo-relative SF: paths fail with "Could not resolve 1 file paths".
const rewritten = readFileSync(lcovPath, "utf8").replace(/^SF:.*$/gm, `SF:${source}`);
writeFileSync(lcovPath, rewritten);
process.stdout.write(`Rewrote LCOV SF to ${source}\n`);
