# Changelog

## 1.1.0

2026-08-19

### Added
- `EvaluatedDefinitions`, `EntityGate`, and `isEntityGate` types for mixed client defs payloads.

## 1.0.0

2026-07-14

### Added
- Shared ES256 signed-definitions verification for browser and Node (`verifySignedDefinitions`, envelope parse helpers).
- `assertEnvelopeFreshness` / `maxSignatureAgeSeconds` to reject replay of old-but-still-valid signed envelopes when configured.
- Shared evaluated-signed response helpers (`parseEvaluatedResponseBody`, `readResponseBody`, `unwrapDefsPayload`) for SSR adapters.

### Notes
- Dependent SDKs must declare `"@ops-ai/toggly-signed-defs": "^1.0.0"` (registry), never `file:`.
- Publish this package before releasing any SDK that depends on it.
