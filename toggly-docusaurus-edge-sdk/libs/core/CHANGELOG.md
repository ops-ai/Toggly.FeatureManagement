# Changelog


## 0.2.3

- Reject HTTP 2xx `{ "error": "…" }` envelopes before applying defs [OPS-901].

## 0.2.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 0.2.1

2026-08-28

### Changed
- Confirm CI release via npm trusted publishing for
  `sdk-client-core-release.yml` (no functional API change).
- Set `repository.url` so provenance publish matches the GitHub source.

## 0.2.0

2026-08-21

### Added
- Entity context evaluation on `getFlag` with `registerContext`. Entity gates
  fail closed without context.

### Fixed
- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

## 0.1.6

2026-07-14

### Added
- `verifySignatures`, `allowedKeyIds`, and `maxSignatureAgeSeconds` on `TogglyConfig`.
- Signature verification via `@ops-ai/toggly-signed-defs` (JWKS at `/.well-known/jwks`) when `verifySignatures` is true.
