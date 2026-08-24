# GitHub-Distributed SDK Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Go, Swift, and CLI package presentation while preserving all repository- and tag-derived coordinates.

**Architecture:** Keep the repository as the registry identity. Standardize README installation/status information, signed release notes, checksums, and GitHub repository presentation; test old and new tags through their ecosystem-native installers.

**Tech Stack:** Go modules, Swift Package Manager, .NET tool packaging, GitHub Releases, signed tags, checksums

**Spec:** `docs/plans/2026-08-24-package-registry-professionalization-design.md`

## Global Constraints

- Do not move repositories or change Go module paths, Swift package URLs/products, CLI package ID, or tag prefixes.
- Keep compatibility with existing install snippets in `README.md` and `.github/RELEASE.md`.
- Public release assets must be built from the exact signed tag and accompanied by checksums where binary assets exist.

---

### Task 1: Add a GitHub-distribution contract

**Files:**
- Create: `.github/package-registry/github-distributed-packages.json`
- Create: `.github/package-registry/verify-github-distributions.mjs`
- Create: `.github/package-registry/verify-github-distributions.test.mjs`
- Modify: `.github/RELEASE.md`

- [ ] Write a failing test that inventories each package's immutable coordinate manifest, release-version source, changelog, workflow, tag prefix, install command, release asset names, and documentation URL.
- [ ] Populate exact coordinate/version pairs: `toggly-go/go.mod` with `toggly-go/VERSION`; `Toggly.FeatureManagement.iOS/Package.swift` with `Toggly.FeatureManagement.iOS/TogglyCore/Sources/TogglyCore.swift`; and `Toggly.CLI/Toggly.CLI.csproj` with `Toggly.CLI/VERSION`.
- [ ] Require every README and release workflow to use the same immutable coordinate, release-version source, and tag prefix as the inventory. For iOS, also require the workflow's synchronized `togglySwiftUIVersion`, `togglyUIKitVersion`, and `togglyCombineVersion` constants.

### Task 2: Polish Go distribution

**Files:**
- Modify: `toggly-go/VERSION` only when a release-visible source change is required
- Modify: `toggly-go/README.md`
- Modify: `toggly-go/CHANGELOG.md` only when a release-visible source change is required
- Modify: `.github/workflows/sdk-go-release.yml`

- [ ] Add status/version/docs/source badges and one canonical `go get` example using the unchanged module path.
- [ ] Preserve signed tag format and add release-source checksum evidence where the workflow creates archives.
- [ ] Run `go test ./...`, `go vet ./...`, the distribution contract test, and a clean temporary-module `go get` against the candidate tag when published.

### Task 3: Polish Swift Package Manager distribution

**Files:**
- Modify: `Toggly.FeatureManagement.iOS/TogglyCore/Sources/TogglyCore.swift` only when a release-visible source change is required
- Modify: `Toggly.FeatureManagement.iOS/README.md`
- Modify: `Toggly.FeatureManagement.iOS/CHANGELOG.md` only when release-visible source changes are required
- Modify: `.github/workflows/sdk-ios-release.yml`

- [ ] Add canonical Xcode/SPM installation instructions using the unchanged repository URL and product names.
- [ ] Verify release tags remain SemVer-compatible for Swift Package Manager and release notes link docs, changelog, and source.
- [ ] Run `swift package resolve`, `swift build`, `swift test`, the distribution contract test, and a clean consumer resolution against the candidate tag when published.

### Task 4: Polish CLI distribution

**Files:**
- Modify: `Toggly.CLI/VERSION`
- Modify: `Toggly.CLI/Toggly.CLI.csproj`
- Modify: `Toggly.CLI/README.md`
- Modify: `Toggly.CLI/CHANGELOG.md`
- Modify: `.github/workflows/cli-build-release.yml`

- [ ] Normalize package author/company/homepage/repository/license/icon/readme metadata while preserving the package ID and command name.
- [ ] Add checksums for every binary archive and include install/upgrade/uninstall commands in release notes.
- [ ] Increment the patch version in `Toggly.CLI/VERSION` and update the changelog when NuGet/tool metadata changes.
- [ ] Run `dotnet build Toggly.CLI/Toggly.CLI.csproj -c Release`, `dotnet pack`, inspect the package, install it into a temporary tool path, run its version/help command, and uninstall it.

### Task 5: Update GitHub repository presentation

**Files:**
- External: repository description, website, topics, social preview, and Releases pages

- [ ] Present exact description, website, topics, and social-preview asset for approval.
- [ ] Apply only approved repository metadata and verify it from a signed-out/fresh page.
- [ ] Run Oracle and hosted checks for each code/release-workflow PR and separately verify published tags/releases after merge.
