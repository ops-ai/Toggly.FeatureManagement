# Changelog

## 0.4.0

2026-09-30

### Added
- Package-manager distribution (Wave 5, OPS-1580): `Toggly.CLI/packaging/` templates + `render-templates.sh` (renders every channel recipe from a published `cli-v*` release's `SHA256SUMS` — no rebuild-per-channel) and `smoke-channel.sh` (generic post-install `--version` assertion).
- `.github/workflows/cli-distribute.yml`: post-release workflow with isolated, `continue-on-error` jobs for Homebrew, Scoop, winget, Chocolatey, and apt/rpm. One channel failing (or a missing ops secret) never fails another and never touches the GitHub Release.
- Homebrew formula and Scoop manifest publish to a single `ops-ai/toggly-cli-dist` repo (`main` branch: `Formula/toggly-cli.rb`, `toggly-cli.json`); apt/rpm feeds (via `nfpm` + `dpkg-scanpackages`/`createrepo_c`) publish to that same repo's `gh-pages` branch.
- winget (`Opsai.TogglyCLI`) and Chocolatey (`toggly-cli`) manifests/packages render every run; automated submission is secrets-gated (`WINGET_TOKEN`, `CHOCO_API_KEY`) and skips gracefully with a clear message when unset.
- All formulas/manifests install the binary on `PATH` as `toggly` (archives keep the `toggly-cli` binary name) per the Wave 5 UX lock.

### Changed
- `Toggly.CLI.csproj` now reads `Toggly.CLI/VERSION` into the assembly `<Version>` so the CLI's version option reports the same value as the `cli-v*` release tag — required for the new per-channel install smoke checks to mean anything.

## 0.3.2

2026-09-29

### Added
- Checked-in command catalog (`Docs/command-catalog.json`) covering auth, app, env, feature, release, context, flat aliases, and globals.
- Generated Linux man pages under `man/` (`toggly.1`, `toggly-auth.1`, …) via `scripts/generate-manpages.py`.
- Catalog coverage tests so new RootCommand leaves cannot ship undocumented.
- Linux release archives (`linux-x64` / `linux-arm64`) include the `man/` directory.

### Changed
- README slimmed to install + quickstart; full docs live at https://docs.toggly.io/sdks/cli.

## 0.3.1

2026-09-29

### Added
- Checked-in ops route subset (`Contracts/cli-ops-routes.json`) shared with `CliApiRoutes` for CI drift detection.
- HTTP contract tests covering every curated management-API command (method/path and write body shape).
- Advisory live smoke script (`scripts/smoke.sh`) and secrets-gated GitHub Actions workflow (`cli-live-smoke.yml`).

## 0.3.0

2026-09-29

### Added
- Noun-first commands: `app`, `env`, `feature`, `release`, and `context` (alongside `auth`).
- List/get reads for applications, environments, features, and releases.
- Global `--json` for machine-readable camelCase output (human text remains the default).
- Non-secret context prefs via `context set|get|clear` under XDG / `~/.config/toggly/` (Windows: `%AppData%\toggly`).
- Default `--app` / `--env` resolution from context prefs when flags are omitted.

### Changed
- Existing write commands remain available as flat aliases (`create-feature`, `update-feature`, `update-feature-environment`, `create-release`, `associate-build`) and also nest under their nouns.

## 0.2.2

2026-09-29

### Added
- OAuth2 device-code login via `toggly auth login|logout|status`.
- OS credential-store session persistence (macOS Keychain, Windows Credential Manager, Linux libsecret).
- Credential resolution priority: explicit client credentials → stored device session → fail with guidance.

### Changed
- Authentication error messages point to `toggly auth login` or CI env vars.
- Device login requests scopes `openid toggly offline_access` so refresh tokens work when the IdP client allows offline access.

## 0.2.1

2026-09-28

### Changed
- Include CLI source and OpenCover test results in both .NET Sonar scans.
- Add command, authentication, and API-client coverage for the CLI executable.

### Fixed
- Keep deprecated credential-store cleanup testable without accessing the active user profile.

## 0.2.0

2026-07-13

### Changed
- Authentication is CLI args and/or environment variables only. Secrets are never persisted to disk.
- Prefer `--client-id` / `--client-secret` for interactive use; use `TOGGLY_CLIENT_ID` / `TOGGLY_CLIENT_SECRET` (and optional `TOGGLY_AUTHORITY` / `TOGGLY_BASE_URL`) in CI.
- On startup, deletes legacy `~/.toggly/config.json` (and an empty `~/.toggly` directory) if present.

### Removed
- Config-file based credential storage.

## 0.1.0

2026-07-05

### Added
- Initial CLI release versioning via `VERSION` manifest (manifest-first release workflow).
