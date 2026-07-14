# Changelog

All notable changes to the Toggly iOS SDK are documented in this file.

## 1.0.1

2026-07-13

### Added
- Production-compatible signed definitions verification (`verifySignatures`) using
  exact raw `defs` JSON bytes, double SHA-256 digests, and ES256 P-256 (Security
  framework digest-level verify). JWKS are fetched from `{baseURI}/.well-known/jwks`.
  When `verifySignatures` is false (default), parsing behavior is unchanged.

### Fixed
- Clear in-memory JWKS on `signing-key-updated` WebSocket messages so retired
  keys are not reused after rotation.
- Reject empty `signature`/`kid` in signed envelopes.
- Signed responses are no longer accepted without cryptographic verification when
  `verifySignatures` is enabled; invalid signatures fall back to cache/defaults and
  populate `lastError`, matching Go / Node / Flutter SDK behavior.
- Harden verification: top-level-only `defs` extraction and apply verified raw
  defs bytes after signature check.
