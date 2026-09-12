# Canonical signature fixtures

These contain public test keys and signatures only. They do not contain a
private signing key, app key, or live service response.

`webcrypto-fixture.json` was supplied by the independent SDK expansion
regression suite at
`Toggly.FeatureManagement.Client/tests/Toggly.FeatureManagement.Client.Tests/webcrypto-fixture.json`.
Its SHA-256 is
`24d6ada5463fceacc1fb215874db8327330ceaec0e8b24825805fe14b71b2f2c`.
Keep this fixture byte-for-byte: its existing signature provides a regression
independent of the Node SDK's signing helpers. Its definitions are an evaluated
object map, so it tests signature verification, not the Node raw-array parser.

`worker-definitions.json` supplies the raw definition array that Node clients
consume. Its SHA-256 is
`a817514931ead3328159b8b53b3d15d72bf6f93d3fd11103f8333f990cecd969`.
It was generated using `node tests/fixtures/generate-worker-fixture.mjs`
on Node 24.18.0. That script uses WebCrypto, not Node's `crypto.sign` API or
the SDK verifier, and writes only public material. Rerunning it creates a
different ephemeral key and signature; update this hash if intentionally
replacing the fixture.

The algorithm follows the Definitions Worker's `signES256` and
`signDefinitions` functions in `src/Toggly.Definitions/src/signer.ts`, inspected
at Toggly commit `9d08819a47d0b5a168a9b976f9396bc10c08f206`:

1. Encode the exact raw definitions plus `|` plus the Unix timestamp as UTF-8.
2. Compute `subtle.digest('SHA-256', payload)`.
3. Sign that digest with `subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ...)`.
   This ECDSA operation hashes once more, producing the canonical double hash.
4. Encode the P-256 `r || s` signature as base64. WebCrypto emits IEEE P1363
   bytes; the Worker's historical DER comment does not change the encoding.
5. Derive the key ID as uppercase SHA-1 of the decoded `x || y` coordinates,
   followed by `ES256`.

The tests also convert the supplied P1363 `r` and `s` values to DER without
signing again. Neither a third hash nor a single-hash signature is accepted as
a fallback. Whitespace changes invalidate the signature even when the parsed
JSON would be equivalent. The fixed timestamp deliberately uses the default
disabled freshness check; freshness enforcement has its own tests.
