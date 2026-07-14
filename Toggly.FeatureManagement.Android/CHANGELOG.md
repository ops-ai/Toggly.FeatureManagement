# Changelog

## 1.0.1

2026-07-13

### Added

- Added opt-in verification of signed definitions using the production ES256,
  double-SHA-256, and raw JSON payload contract.

### Fixed

- Reject empty `signature`/`kid` in signed envelopes.
- Refresh definitions on `signing-key-updated` WebSocket messages.
- Harden verification: top-level-only `defs` extraction and apply verified raw
  defs bytes (never re-parsed outer envelope fields after verify).
