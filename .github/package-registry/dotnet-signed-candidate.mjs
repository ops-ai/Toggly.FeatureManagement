/** Seal once after certificate signing; consumers verify immutable bytes before any push. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function checksums(directory) {
  const packages = path.join(directory, "nupkgs");
  const names = fs
    .readdirSync(packages)
    .filter((name) => /\.(?:nupkg|snupkg)$/.test(name))
    .sort();
  if (!names.length)
    throw new Error("Signed candidate contains no NuGet artifacts");
  return names
    .map((name) => {
      if (!/^[A-Za-z0-9_.-]+$/.test(name))
        throw new Error("Invalid signed artifact filename");
      const digest = createHash("sha256")
        .update(fs.readFileSync(path.join(packages, name)))
        .digest("hex");
      return `${digest}  ${name}\n`;
    })
    .join("");
}

export function sealSignedCandidate(directory) {
  // Refuse to replace earlier evidence even if a caller accidentally repeats signing.
  fs.writeFileSync(path.join(directory, "SHA256SUMS"), checksums(directory), {
    flag: "wx",
  });
}

export function verifySignedCandidate(directory) {
  const expected = fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8");
  if (expected !== checksums(directory))
    throw new Error("Signed candidate checksum mismatch");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const directory = path.resolve(process.argv[3] ?? "release-candidate");
  if (process.argv[2] === "seal") sealSignedCandidate(directory);
  else if (process.argv[2] === "verify") verifySignedCandidate(directory);
  else throw new Error("Expected seal or verify command");
}
