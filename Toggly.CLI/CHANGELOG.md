# Changelog

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
