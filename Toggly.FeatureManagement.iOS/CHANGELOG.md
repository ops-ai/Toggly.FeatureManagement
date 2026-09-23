# Changelog

All notable changes to the Toggly iOS SDK are documented in this file.

## 1.6.0

2026-09-22

### Added
- `TogglyConfig.enableVariants` opts into server-evaluated feature variants. When enabled, `TogglyService` fetches definitions from the variants endpoint instead of the boolean endpoint and exposes `getVariant(_:recordCheck:)` and `getVariantValue(_:)`, returning a `VariantResult` with the assigned variant name and an untyped `configurationValue`.
- `FeatureVariant` SwiftUI property wrapper for reactive access to a variant assignment, mirroring `FeatureFlag`.

### Changed
- Cached definitions are now segregated by evaluation mode (boolean vs. variants) so switching `enableVariants` on an existing installation cannot mix incompatible cache payloads.

## 1.5.2

2026-09-21

### Fixed
- Install all four Swift products directly from the Git repository root using an exact `ios-sdk-v` release reference. The nested package and existing platform requirements remain supported.

## 1.5.1

2026-09-21

### Fixed
- Remove inherited `userId` query parameters from definitions requests when a minted `instanceId` is active, including repeated and percent-encoded parameter names. Requests without a token retain their existing query behavior.

## 1.5.0

2026-09-19

### Added
- Frontend telemetry for evaluated feature checks, including SwiftUI, UIKit, and Combine paths. Telemetry is enabled when an app key is configured and can be disabled with `enableTelemetry: false`.
- `recordUsage`, `recordView`, `incrementCounter`, `setGauge`, and awaitable `flushTelemetry` methods on `TogglyService`.
- Host-minted `instanceId` configuration, atomic `setIdentity(_:instanceId:)`, and `setInstanceId(_:)` rotation/clearing. Tokens take precedence over client identities in definitions and telemetry.
- `metricsBaseUrl`, `telemetryFlushIntervalMs`, and `onTelemetryDiagnostic` configuration options. A background app-state transition flushes buffered events.

### Changed
- Telemetry requests use the independent metrics endpoint and carry the app key, environment, feature counts, app-level metric values, and optional minted token (`i`) or client identity (`u`). Groups, claims, and entity data remain excluded. Client-identity acceptance is controlled by the server, off by default; HTTP 202 does not establish identity acceptance. Invalid intervals use the 45-second default; invalid metrics endpoints disable telemetry without affecting feature checks.
- Ordinary telemetry flushes use native gzip; if compression fails before send, the SDK sends plain JSON. Final disposal flushes use plain JSON.

### Fixed
- Combine gates initialize one subscription and count captured short-circuit checks only when downstream demand accepts the result.
- UIKit stop, unbind, and rebind operations remove their exact observers, including control-enabled bindings and suspended setup.
- Packetization transfers one envelope at a time; resource inspection measures sizes without serializing the queue, and gzip output stays within the envelope limit.
- Retained payload and accounting metadata share one 2,000-entry/256 KiB budget across identity rotations. Rejected or drained names do not remain in a historical catalog.
- Disposal cancels backoff and sends at most one final envelope; expired batches are released.
- Delayed UI checks retain their original owner and identity. Old definitions responses and invalid-cache cleanup cannot overwrite or delete a newer token context.
- The UIKit target excludes UIKit-only declarations on watchOS, where those view types are unavailable.

## 1.4.0

2026-09-08

### Added
- Initial `groups` and string `claims` on `TogglyConfig`, applied before the first evaluated request. Claims omit empty names/values and retain the first 20 sorted types.

### Fixed
- Encode identity, repeated groups, and claims safely, including literal plus signs.
- Reject responses superseded by identity changes, including changes during signature verification or storage; refresh the new context without reusing obsolete flags or validators.
- Bind evaluated caches and revision storage to the complete normalized context using structured serialization and SHA-256. Legacy identity-only caches are reused only without groups or claims.

## 1.3.0

2026-09-02

### Changed
- SwiftUI: `FeatureView` / `FeatureGateView` use `negate` as the primary off
  path; dual-slot `else:` is documented as Variant-style, not the primary Off
  API. Both views accept optional entity `context` / `kind`.
- SwiftUI: `@FeatureFlag`, `@FeatureGate`, and `.featureFlag` support `negate`
  and entity context. `.featureFlagOff` is deprecated in favor of
  `.featureFlag(..., negate: true)`.

## 1.2.0

2026-08-21

### Added
- Client-side entity-gate evaluation (eq, neq, gt, gte, lt, lte, in, contains)
  with fail-closed missing attributes, unknown operators, and empty rules.
- `registerContext` (local mapper only; no schema PUT) and
  `isEnabled(_:context:)` / `evaluateFeatureGate(..., context:)`.
- Mixed boolean + entity-gate definitions are stored internally; the public
  `FeatureFlags` map remains a derived snapshot (gates flatten to `false`
  without context).

### Fixed
- `parseDefinitions` no longer throws `invalidEnvelope` when `defs` contains
  entity-gate objects instead of booleans.

## 1.1.0

2026-07-14

### Added
- Persist signed-envelope metadata (`timestamp`, `signature`, `keyId`) with the
  exact raw defs JSON when `verifySignatures` succeeds, and re-verify on cold
  start before trusting cache (Flutter parity).
- Optional `maxSignatureAgeSeconds` on `TogglyConfig` to reject stale envelopes.
- Persist JWKS for offline cold-start re-verify; soft-fail (keep last-known-good)
  when JWKS/network is unavailable, fail closed on invalid signatures.

### Fixed
- When JWKS is available on cold-start re-verify, fail closed for all verification
  errors (unknown kid, key material issues), not only `invalidSignature`.

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
