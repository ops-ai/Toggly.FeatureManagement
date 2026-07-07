# SDK Release Guide

Manifest-first release policy for all Toggly SDK packages in this repository.

## Policy

1. **Bump version and CHANGELOG in your PR/commit** when you change a publishable package.
2. **Merge to `develop`.**
3. **Run the release workflow** with defaults (`release_mode: publish`).
4. The workflow **publishes the manifest version** — it does not bump by default.

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
3. Merge to develop
4. Actions → Run release workflow → leave defaults
5. Confirm summary shows action=publish
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

All sibling packages must share the same version. The workflow validates this before publishing.

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
| `sdk-go-release.yml` | `toggly-go/VERSION` | git tag (`go-sdk-v*`) |
| `sdk-php-release.yml` | `composer.json` | Packagist |
| `cli-build-release.yml` | `Toggly.CLI/VERSION` | git tag (`cli-v*`) |

**PHP monorepo workflow:** `sdk-php-release.yml` requires `Toggly.FeatureManagement.PHP/` in the checkout. If that directory is absent, use the release workflow in the standalone **Toggly.FeatureManagement.PHP** repository instead.

See [package-versioning rule](../../../.cursor/rules/package-versioning.mdc) for semver and changelog conventions.
