import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const fixture = JSON.parse(
  readFileSync(new URL('./webcrypto-fixture.json', import.meta.url), 'utf8'),
);
// Independently generated WebCrypto fixture, shared with the portable .NET client regression.
// This must pass in the corrected dependency; do not replace it with a Node self-signed triple hash.
it('accepts the same canonical Worker signature in WebCrypto and the Node shared verifier', async () => {
  const key = await crypto.subtle.importKey(
    'jwk',
    fixture.jwks.keys[0],
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const first = createHash('sha256')
    .update(fixture.defs + '|' + fixture.timestamp)
    .digest();
  expect(
    await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      Buffer.from(fixture.signature, 'base64'),
      first,
    ),
  ).toBe(true);
  const { verifySignedDefinitions } = createRequire(import.meta.url)('@ops-ai/toggly-signed-defs');
  await expect(
    verifySignedDefinitions(fixture.defs, fixture, fixture.jwks),
  ).resolves.toBeUndefined();
});
