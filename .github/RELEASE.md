# SDK Release Guide

Manifest-first release policy for all Toggly SDK packages in this repository.

## Policy

1. **Bump version and CHANGELOG in your PR/commit** when you change a publishable package.
2. **Merge to `develop`.** Path-filtered `sdk-*-release.yml` workflows start automatically.
3. The release **re-runs that family’s required analysis gates**, then **publishes the manifest version** when it is ahead of the registry (skip if equal, fail if behind). It does not bump by default.
4. **Manual `workflow_dispatch`** remains for retries, Flutter tag re-publish, and legacy `release_mode: auto_bump`.

See [OPS-1243 design](https://github.com/ops-ai/Toggly.wiki/blob/wikiMaster/Home/Engineering/Plans/2026-09-15-SDK-Auto-Publish-On-Develop-Design.md) for the full contract.

## Automatic develop publish

After a human merges to `develop`, each path-filtered `sdk-*-release.yml` workflow:

1. **Resolves** the manifest against the registry (`publish` / `skip` / `fail`). Push events always use `release_mode: publish` (no auto-bump).
2. **Re-runs required analysis gates** via `workflow_call` into the matching `analysis-*.yml` (`run_reporting: false` skips Sonar/OWASP). Multi-package JS analysis accepts an `sdks` filter (e.g. `Vue`) so one package does not re-test the whole matrix.
3. **Publishes** only from a job that uses the registry environment (`npm-publish`, `nuget-publish`, …). Resolve and gates do not use that environment.

Analysis workflows remain the **PR** merge gate (`pull_request` + `workflow_dispatch`). They no longer run on push to `develop`/`main`; the release path owns post-merge verification.

## npm public packages (`@ops-ai/*`)

Before shipping a **new** public npm package:

1. Add a row to [`.github/package-registry/npm-packages.json`](package-registry/npm-packages.json) (`name`, `manifest`, `changelog`, `workflow`, `docsUrl`).
2. Satisfy the metadata contract enforced by `verify-npm-metadata.mjs` (`author` `Toggly <support@toggly.io>`, `MIT`, exact docs `homepage`, `repository.url` + `repository.directory`, GitHub `bugs`, `publishConfig.access: public`, required keywords). Never publish `#develop` or `/tree/develop/` links.
3. Point `workflow` at an existing `sdk-*-release.yml` (or add one) that publishes with `--provenance`.
4. Configure npm **Trusted Publisher** for that package → repository `ops-ai/Toggly.FeatureManagement`, exact workflow filename, environment `npm-publish`. Set `oidcReady: true` in the inventory only after a successful OIDC publish, then remove `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN` fallback from that workflow.
5. Run locally: `node --test .github/package-registry/verify-npm-metadata.test.mjs` and `node --test .github/package-registry/verify-npm-trusted-publishing.test.mjs`.

Governance notes: [`.github/package-registry/npm-governance-status.md`](package-registry/npm-governance-status.md).

## NuGet (`Toggly.*`)

Trusted publishing: nuget.org policy must match repository `ops-ai/Toggly.FeatureManagement`,
workflow `sdk-dotnet-release.yml`, environment `nuget-publish`.
`NuGet/login@v1` `user` is the trust-policy **creator** username (`opsai`), not the
package-owner org (`Toggly`). Key Vault signing is unchanged. Do not store a NuGet
API key in GitHub once OIDC has succeeded.

## Workflow inputs

| Input | Default | Description |
|-------|---------|-------------|
| `release_mode` | `publish` | `publish` uses the version in the manifest; `auto_bump` is a legacy escape hatch |
| `bump_type` | `patch` | Only used when `release_mode` is `auto_bump` |
| Package selectors | varies | e.g. Flutter `package`, Node `packages`, Nuxt `packages` |

## How version resolution works

The shared action [`.github/actions/resolve-release-version`](actions/resolve-release-version/action.yml) compares the manifest version to the registry (or git tag when `registry: none`):

| Result | Meaning |
|--------|---------|
| **publish** | Manifest is ahead of registry — publish proceeds |
| **skip** | Version already on registry — nothing to do |
| **fail** | Manifest is behind registry — bump version in a PR first |

## Developer checklist

```text
1. Implement change
2. Bump version + CHANGELOG in the same commit
3. Merge to develop (release workflow starts on path match)
4. Confirm Actions run: resolve → gates → publish (or action=skip)
5. For retries / auto_bump only: Actions → Run workflow manually
```

## Troubleshooting

### "manifest X is behind registry Y"

The registry has a newer version than your repo. Bump the manifest in a PR before releasing.

### Workflow skipped (action=skip)

That version is already published. Bump the manifest if you have unreleased changes.

### Emergency release without a version bump

Use `release_mode: auto_bump` and choose `bump_type`. This updates the manifest, publishes, and commits the bump back. Prefer fixing the manifest in a PR instead.

### Flutter publish (pub.dev OIDC)

Publishing uses [GitHub Actions OIDC](https://dart.dev/tools/pub/automated-publishing) — no upload token or Google sign-in in CI.

**One-time setup per package** on [pub.dev Admin](https://pub.dev/packages/feature_flags_toggly/admin) → **Automated publishing**:

| Package | Tag pattern |
|---------|-------------|
| `feature_flags_toggly` | `flutter-sdk-v{{version}}` |
| `feature_flags_toggly_secure_storage` | `flutter-secure_storage-v{{version}}` |
| `feature_flags_toggly_disk` | `flutter-disk-v{{version}}` |
| `feature_flags_toggly_sqlite` | `flutter-sqlite-v{{version}}` |
| `feature_flags_toggly_isar` | `flutter-isar-v{{version}}` |

For each package:

1. **Repository:** `ops-ai/Toggly.FeatureManagement`
2. **Tag pattern:** row from the table above (not `v{{version}}`)
3. Enable **Enable publishing from push events** (tag push triggers publish)
4. Optionally enable **Enable publishing from workflow_dispatch events**

**Release flow:**

1. Run **Flutter SDKs - Build & Publish** on `develop` (workflow_dispatch) — validates, tests, pushes a signed tag.
2. The tag push starts a second run that publishes to pub.dev via OIDC and creates the GitHub Release.

pub.dev requires the publish job to run on a **tag ref**, not a branch — that is why publish is split from tagging.

### Tag already exists (tag-and-push failed)

If an earlier run pushed the tag but publish failed (e.g. dry-run validation), re-running from `develop` fails with `tag already exists`.

**Retry publish without a new tag:**

1. Actions → **Flutter SDKs - Build & Publish** → **Run workflow**
2. Set **Use workflow from** to the release tag (e.g. `flutter-secure_storage-v0.1.2`)
3. Package can stay as-is (inferred from the tag on tag refs)

That run skips `tag-and-push` and executes the `publish` job only. The publish job checks out **`develop`** (not the tag commit) so publish fixes on develop apply, as long as the manifest version still matches the tag.

If `develop` has moved past that version, bump the manifest and push a new tag instead.

### Monorepo packages (Nuxt, Next, Remix, React Native, Node server)

Each sibling package is published at **its own** manifest version. Core
being ahead of a sibling is not a failure: already-published versions are
skipped. Do not bump unrelated siblings just to satisfy a lockstep check.

## Workflows

| Workflow | Manifest | Registry |
|----------|----------|----------|
| `sdk-javascript-release.yml` | `package.json` | npm |
| `sdk-react-release.yml` | `package.json` | npm |
| `sdk-angular-release.yml` | `projects/ngx-feature-flags-toggly/package.json` | npm |
| `sdk-node-server-release.yml` | per-package `package.json` | npm |
| `sdk-flutter-release.yml` | `pubspec.yaml` | pub.dev |
| `sdk-dotnet-release.yml` | `Directory.Build.props` | NuGet |
| `sdk-rust-release.yml` | `Cargo.toml` | crates.io |
| `sdk-python-release.yml` | `pyproject.toml` | PyPI |
| `sdk-ruby-release.yml` | `lib/toggly/version.rb` | RubyGems |
| `sdk-go-release.yml` | `toggly-go/VERSION` | git tag (`toggly-go/v*`) |
| `sdk-go-mongodb-v2-release.yml` | `toggly-go-mongodb-v2/VERSION` | git tag (`toggly-go-mongodb-v2/v*`) |
| `sdk-php-release.yml` | `composer.json` | Packagist |
| `sdk-android-release.yml` | `build.gradle.kts` | Maven Central (git tag skip) |
| `sdk-java-release.yml` | `pom.xml` | Maven Central |
| `cli-build-release.yml` | `Toggly.CLI/VERSION` | git tag (`cli-v*`) |

### Maven Central (Android / Java)

Secrets (repo-level, shared): `MAVEN_CENTRAL_USERNAME`, `MAVEN_CENTRAL_PASSWORD`,
`GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`, plus `RELEASE_PUSH_TOKEN` for signed tags.

Use a Central Portal **user token** (not account password) for
`MAVEN_CENTRAL_USERNAME` / `MAVEN_CENTRAL_PASSWORD`.

- **Android:** Gradle + vanniktech → `publishAllPublicationsToMavenCentralRepository`.
  Skip detection, the git tag, and GitHub notes all use the **root**
  `allprojects { version }` in `Toggly.FeatureManagement.Android/build.gradle.kts`.
  Keep every module on that version (`SdkIdentity.SDK_VERSION`, README snippets,
  `CHANGELOG.md`). Do not set a per-module `version` — the 1.3.0 tag published
  core as 1.4.0 and wrappers as 1.3.0, so notes advertised a missing coordinate.
- **Java:** `mvn -B -Prelease clean deploy` with
  `central-publishing-maven-plugin` (`server-id: central`) and `maven-gpg-plugin`.
  The release workflow writes `~/.m2/settings.xml` with the Portal user token
  (literal values). setup-java's `${env.*}` placeholders are not reliable with
  this plugin and previously caused HTTP 401 on upload.

Bump the parent `pom.xml` version, child `<parent><version>`, `SdkIdentity.SDK_VERSION`,
README install snippets, and `CHANGELOG.md` in the same PR before running
**Java SDK - Release** with `release_mode: publish`.

**PHP monorepo workflow:** `sdk-php-release.yml` requires `Toggly.FeatureManagement.PHP/` in the checkout. If that directory is absent, use the release workflow in the standalone **Toggly.FeatureManagement.PHP** repository instead.

See [package-versioning rule](../../../.cursor/rules/package-versioning.mdc) for semver and changelog conventions.

## Unified .NET package release

All NuGet families use `sdk-dotnet-release.yml` and grouped `analysis-dotnet.yml`.
The inventory in `package-registry/nuget-packages.json` owns package IDs, project
paths, family tests and changelogs. Adding a publishable C# project without an
inventory record fails validation. Do not create another NuGet release workflow.

Select `all`, an exact family name (`server`, `distributed-client`, `blazor`),
package IDs, or the existing server aliases such as `Core` and `Web`.
Dependencies present in the inventory are included automatically and published
first. Each package is compared to NuGet independently: an already published
server version does not skip an unpublished client. Each selected family runs
tests/coverage before
artifacts are packed and verified; signing and publication use those artifacts.

All .NET packages inherit one version from
`Toggly.FeatureManagement.NET/Directory.Build.props`. Project-level version
overrides fail validation. The default `publish` mode compares that common version
to each selected package's registry version: equal versions skip, newer source
versions publish, and versions behind NuGet fail. Legacy `auto_bump` updates the
common manifest once, even for a client-only selection, then resolves every
sibling at that version and retains the signed shared-version commit. Prefer
version/changelog changes reviewed in a PR.

The protected `nuget-publish` job retains direct NuGet OIDC, existing Key Vault
package/symbol signing and paced HTTPS timestamps. All action references use
immutable commit SHAs with readable version comments; weekly Dependabot updates
keep those pins current. Before first publication, verify that the `opsai` trust
policy covers each new package through `sdk-dotnet-release.yml` and the existing
environment. No API-key fallback is introduced.

Server GitHub release tags retain `dotnet-sdk-v<version>`. Other families
use `dotnet-<family>-sdk-v<version>`, with package IDs/versions in the release
notes and GPG-signed checksums for the signed artifacts. A family tag retains its
first publication commit. Later sibling packages at the same version append their
package list and immutable, content-addressed checksum assets to that release;
retries retain earlier assets and notes. Workflow runs are serialized across refs
to avoid concurrent publication races. Re-run failed jobs to resume the retained
candidate after a partial registry push. CLI binary releases
continue through `cli-build-release.yml`; the CLI is not a NuGet SDK package.

### Blazor family

The `blazor` family participates in the same inventory-driven analysis and manual
release workflow. Its browser package depends on portable Client at the common
.NET version. Internal SDK project references keep source builds independent of
unpublished packages; packing emits versioned NuGet dependencies. Dependency order
is derived from the inventory and actual project references. The server adapter
follows the Blazor browser package and trusted server core. The SDK packed-consumer
checks use the complete local candidate feed; Toggly.Samples remains a separate
public-package installation gate.

The Blazor runtime compatibility jobs retain .NET 8/.NET 10 tests, browser crypto
coverage and packed consumer checks in `analysis-dotnet.yml`. No separate Blazor
publication workflow is used. Registry publisher permissions still need to cover
the new package IDs; configuration does not prove first publication.

### Frontend .NET telemetry verification

The portable/Desktop and Blazor browser packages share the version above. Keep their changelogs and install examples aligned. Their unit suites consume the common frontend telemetry contract; fake application keys use opt-out or a local/injected transport.

The existing Blazor runtime job also builds `Toggly.FeatureManagement.Blazor/tests/WasmHost` against the local packed feed, then runs `tests/wasm-browser.cjs` with the established dashboard Playwright dependency. This checks the trimmed managed WASM artifact (without AOT), actual WASM ownership, cross-origin loopback CORS, ordinary gzip payloads, plain keepalive fetch on hidden/pagehide, and teardown. `test-browser.sh` is a separate Node module contract/coverage check. The Server example remains a packed server consumer. Local packages and loopback ingestion do not prove public registry installation or designated live ingestion.
