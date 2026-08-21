# Changelog

## 1.3.1

2026-07-14

### Added
- `verifySignatures`, `allowedKeyIds`, and `maxSignatureAgeSeconds` on `TogglyConfig` for server-side signature verification.

## 1.3.0

2026-07-05

### Added
- `groups` and `claims` on `TogglyConfig` and `IdentityContext` for server-side evaluated definitions.

### Changed
- `buildDefinitionsUrl` uses `@ops-ai/toggly-hooks-types@^1.3.0` (`appendEvaluationContext`).

## 1.2.0

2026-07-03

### Added

- `onError` reports Remix flag fetch failures to consumers.

## 1.1.0

2026-06-28

### Added

- `localGates` on `TogglyConfig` and `LocalGate` type export for device-local post-filter gates.
