# Changelog

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
