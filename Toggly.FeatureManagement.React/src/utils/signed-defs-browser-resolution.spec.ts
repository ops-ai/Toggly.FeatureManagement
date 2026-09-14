import { webcrypto } from 'node:crypto';
import { computeKid, verifySignedDefinitions } from './signed-defs-verify';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
    writable: true,
  });
});

describe('public signer browser resolution', () => {
  it('loads the browser entry and verifies a WebCrypto-generated envelope in jsdom', async () => {
    const keys = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
    const x = publicJwk.x!;
    const y = publicJwk.y!;
    const kid = await computeKid(x, y);
    const defs = '{"enabled":true}';
    const timestamp = 1;
    const firstDigest = await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${defs}|${timestamp}`)
    );
    const signature = await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      firstDigest
    );

    await expect(
      verifySignedDefinitions(
        defs,
        { signature: Buffer.from(signature).toString('base64'), timestamp, kid },
        { keys: [{ kty: 'EC', use: 'sig', alg: 'ES256', crv: 'P-256', x, y, kid }] }
      )
    ).resolves.toBeUndefined();
  });
});
