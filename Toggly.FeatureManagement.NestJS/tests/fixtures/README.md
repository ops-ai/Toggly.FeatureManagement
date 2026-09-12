# Canonical Worker contract fixtures

`canonical-worker.json` contains public keys and signatures only; no private keys, app keys or live response data. SHA-256: `853826073be7accea999ddc15d7e986e7c32c16afb1efc79d7e2174a863cc3f9`.

Generated independently with Node 24.18.0 WebCrypto by `generate-canonical-fixtures.mjs`, following Toggly Definitions Worker `src/Toggly.Definitions/src/signer.ts` at commit `9d08819a47d0b5a168a9b976f9396bc10c08f206`: SHA-256 of the exact raw definitions, `|`, and Unix timestamp; ECDSA-SHA256 signs that digest (canonical double hash). Key IDs are uppercase SHA-1 of decoded x/y coordinates plus ES256. The test separately verifies both public fixtures with WebCrypto before exercising the SDK. No SDK signer or verifier creates these signatures.

Initial rules target alice; a separately generated rotated key signs rules targeting bob. Identity, groups, claims, HTTP fields and Order entity checks run through real Nest HTTP request services. Invalid raw bytes, timestamp, signature and unknown cached kid must preserve last-known-good decisions. A signing-key-updated WebSocket message must refetch JWKS and adopt the new rules. The fixed timestamp uses the core default disabled freshness limit.

Regeneration deliberately creates new ephemeral keys and signatures, so update this hash if replacing the fixture.
