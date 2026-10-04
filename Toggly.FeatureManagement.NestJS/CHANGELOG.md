## 0.5.0

2026-10-04

### Added
- Re-export `createSegmentMembershipClient` from `@ops-ai/toggly-segments`.

## 0.4.0

2026-09-28

### Changed

- Peer range for `@nestjs/common` and `@nestjs/core` is now
  `^10.0.0 || ^11.0.0 || ^12.0.0` so Nest 12 hosts are supported alongside
  Nest 10 and 11 [OPS-1565].
- Release compat matrix installs Nest 10, 11, and 12 [OPS-1565].

## 0.3.0

2026-09-24

### Added

- Typed `getVariantValue<T>(…, isT?)` with soft-null decode and optional runtime type guard.
- Exported `decodeVariantValue` helper for the same soft decode policy.

### Notes

- Requires `@ops-ai/toggly-node-core` 0.11.0 or newer (typed soft-null `getVariantValue` / `decodeVariantValue`).

# Changelog

## 0.2.0 — 2026-09-23

### Added

- `TogglyService.getVariant(key, overrides?)` and `getVariantValue(key, overrides?)` assign feature variants catalog-locally (no server round trip), bound to the request-scoped evaluation context, mirroring `isFeatureOn`/`evaluateFeatureGate` [OPS-1395].
- Re-export `VariantResult` from `@ops-ai/toggly-node-core` [OPS-1395].

### Notes

- Requires `@ops-ai/toggly-node-core` 0.10.0 or newer once published; bump the dependency range in a fast-follow after that release lands.

## 0.1.0 — 2026-09-12

### Added

- NestJS 10/11 HTTP module with synchronous and asynchronous configuration.
- Request-scoped evaluation service, feature guards, decorators and parameter injection.
- Application-owned Node core initialization/shutdown, snapshots, signatures, live updates and telemetry.

### Fixed

- Require Node core 0.9.1 or newer so canonical Worker signatures are accepted before request-scoped evaluation.
- Verify canonical signature acceptance, tamper rejection and key rotation with independent public WebCrypto fixtures and installed adapter artifacts.
