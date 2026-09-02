# Changelog


## 1.5.0

2026-09-02

### Added

- `evaluationMode?: 'local' | 'remote'` on `TogglyConfig` (default `remote`) for
  dual-rail definitions fetches.
- Local evaluation helpers `isFeatureEnabledLocal` and
  `evaluateFeatureGateLocal` backed by `@ops-ai/toggly-eval`.
- Re-exports of `evaluateDefinitions`, `indexDefinitions`,
  `parseDefinitionsPayload`, `snapshotEvaluatedBooleans`, and related types for
  remix-toggly-server wiring.

### Changed

- `buildDefinitionsUrl` uses `definitions-signed` (no context query params)
  when `evaluationMode` is `local`; remote mode keeps `evaluated-signed`.
- Depends on `@ops-ai/toggly-eval@^2.0.0` SHA-256 sticky buckets (cohort
  shift vs FNV / eval 1.x) [OPS-832].
- Rollup leaves `@ops-ai/toggly-eval` (and sibling `@ops-ai/*` deps) external
  so the published package installs eval from npm instead of bundling it.

## 1.4.2

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.4.1

2026-08-28

### Fixed

- Publish shared packages as caret ranges instead of `file:` paths so the
  package installs from npm.

## 1.4.0

2026-08-21

### Added
- Entity context helpers (`registerContext`, `isFeatureEnabled` with optional
  context). Entity gates fail closed without context.

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
