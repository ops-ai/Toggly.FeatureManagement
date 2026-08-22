# Changelog

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
