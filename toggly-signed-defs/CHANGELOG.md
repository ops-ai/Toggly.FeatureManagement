# Changelog

## 1.2.7

2026-09-12

### Fixed
- Carry browser WebCrypto provider selection inside both compiled module trees,
  so legacy main/module resolution and dist-only dependency overlays stay browser
  safe. Preserve Node 18 CJS/ESM providers and signature validation [OPS-1176].

## 1.2.6

2026-09-12

### Fixed
- Retain Node 18 support through its built-in WebCrypto provider while keeping
  the browser artifact free of Node imports.
- Reject malformed DER sequence lengths, trailing bytes, and noncanonical
  INTEGER encodings before verifying signatures.
- Verify canonical ES256 signed definitions with WebCrypto in Node and browser
  consumers, avoiding the Node verifier's incompatible extra hash.
- Add a browser export condition with a browser-specific ESM artifact, so
  browser bundlers do not resolve a Node crypto path while preserving the
  existing Node CJS and ESM entry points [OPS-1176].

## 1.2.5

2026-09-04

### Fixed
- Reject evaluated-signed 2xx error envelopes (`{"error":…}`) in
  `unwrapDefsPayload`, `asVariantDefsRecord`, and `rejectEvaluatedErrorEnvelope`
  so client SDKs cannot latch empty success [OPS-899].

## 1.2.4

- Normalize public npm metadata for provenance and docs links (no API change).

## 1.2.3

2026-08-23

### Added
- `asVariantDefsRecord` and `resolveEvaluatedFetchErrorState` so client SDKs
  share variant-map coercion and fetch-error cache fallback.

## 1.2.2

2026-08-23

### Added
- `fetchEvaluatedSignedDefinitions` to fetch, honor 304/If-None-Match, and parse
  evaluated-signed defs through the shared JWKS cache.

## 1.2.1

2026-08-23

### Added
- `readAndParseEvaluatedResponseCached` so client SDKs can parse evaluated
  responses through the shared JWKS cache without duplicating option wiring.

## 1.2.0

2026-08-21

### Added
- `signedDefsClientOptions` to wire client SDKs to a shared `InMemoryJwksCache`
  (`null` `maxSignatureAgeSeconds` maps to `undefined`).
- Public `readAndParseEvaluatedResponse` helper for unwrapping unsigned payloads
  and verifying signed envelopes before applying defs.

## 1.1.0

2026-08-20

### Added
- First published artifact: ES256 signed-definitions verification for browser and Node
  (`verifySignedDefinitions`, envelope parse helpers).
- `assertEnvelopeFreshness` / `maxSignatureAgeSeconds` to reject replay of
  old-but-still-valid signed envelopes when configured.
- Shared evaluated-signed response helpers (`parseEvaluatedResponseBody`,
  `readResponseBody`, `readAndParseEvaluatedResponse`, `unwrapDefsPayload`,
  `InMemoryJwksCache`) for SSR adapters and client SDKs.
- `EvaluatedDefinitions`, `EntityGate`, and `isEntityGate` types for mixed
  client defs payloads.
- Dual CJS/ESM build with an `exports` map so bundlers resolve named exports.

### Notes
- Publish this package before releasing any SDK that depends on it.
- Published dependent manifests must use `"@ops-ai/toggly-signed-defs": "^1.1.0"`.
  Monorepo packages may keep `file:` so local CI can resolve the unpublished
  workspace copy.
