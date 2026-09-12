/** Preserve immutable family tags and append disjoint publication evidence on retries. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function createReleases(releases, directory, run, prerelease = false) {
  for (const release of releases) {
    // A later sibling publication can share the family version. Never move its tag.
    const remoteTag = run("git", [
      "ls-remote",
      "--tags",
      "origin",
      `refs/tags/${release.tag}`,
    ]).trim();
    if (!remoteTag) {
      const localTag = run("git", ["tag", "--list", release.tag]).trim();
      if (!localTag) {
        run("git", ["tag", "-s", "-m", release.tag, release.tag]);
      }

      run("git", ["push", "origin", release.tag]);
    }

    // Listing succeeds even when the release does not exist; authentication failures still fail closed.
    const existing = JSON.parse(
      run("gh", [
        "api",
        "--paginate",
        "--slurp",
        "repos/{owner}/{repo}/releases",
      ]),
    )
      .flat()
      .find((item) => item.tag_name === release.tag);
    const notes = fs.readFileSync(release.notes, "utf8");
    const assets = release.assets.map((asset) => path.join(directory, asset));
    if (!existing) {
      const args = [
        "release",
        "create",
        release.tag,
        ...assets,
        "--verify-tag",
        "--title",
        release.tag,
        "--notes-file",
        release.notes,
      ];
      if (prerelease) {
        args.push("--prerelease");
      }

      run("gh", args);
      continue;
    }

    // Content-addressed checksum names never overwrite an earlier batch's signed evidence.
    for (const asset of assets) {
      if (!existing.assets.some((item) => item.name === path.basename(asset))) {
        run("gh", ["release", "upload", release.tag, asset]);
      }
    }

    if (!(existing.body ?? "").includes(release.marker)) {
      const combinedNotes = path.join(directory, `${release.tag}-combined.md`);
      fs.writeFileSync(combinedNotes, `${existing.body ?? ""}\n\n${notes}`);
      run("gh", [
        "release",
        "edit",
        release.tag,
        "--notes-file",
        combinedNotes,
      ]);
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const directory = process.argv[2] ?? "release-candidate";
  const releases = JSON.parse(
    fs.readFileSync(path.join(directory, "releases.json"), "utf8"),
  );
  const run = (binary, args) =>
    execFileSync(binary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });

  createReleases(releases, directory, run, process.env.PRERELEASE === "true");
}
