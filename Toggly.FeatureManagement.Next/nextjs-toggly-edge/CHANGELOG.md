# Changelog


## 1.2.1

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.2.0

2026-08-21

### Changed
- Document that edge middleware collapses `EntityGate` definitions to `false`
  because there is no per-request entity context (`toBooleanDefinitions`
  without context).

## 1.1.1

2026-07-14

### Added
- Honors `verifySignatures`, `allowedKeyIds`, and `maxSignatureAgeSeconds` from core config on edge fetches via `@ops-ai/toggly-signed-defs`.

## 1.1.0

2026-07-03

### Added

- `onError` reports edge definition fetch failures to consumers.

### Fixed

- Preserved last-known-good edge flags on transient fetch failures instead of overwriting initialized state with defaults.
