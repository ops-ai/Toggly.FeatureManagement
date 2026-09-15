// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { initTogglyClient, $flags, __resetClient } from '../client/store.js';
import { createTogglyServerClient } from '../server/toggly-server.js';

afterEach(() => { __resetClient(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('verifies signed browser and server definitions without SDK headers on public JWKS', async () => {
  vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1');
  const keyPair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  // Canonical public-coordinate key identifier; integrity uses ECDSA/SHA256.
  const kid = createHash('sha1').update(Buffer.concat([
    Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url'),
  ])).digest('hex').toUpperCase() + 'ES256';
  const jwksHeaders: Headers[] = [];
  const definitionHeaders: Headers[] = [];
  vi.stubGlobal('fetch', async (input: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    if (input.endsWith('/.well-known/jwks')) {
      jwksHeaders.push(headers);
      const sdkHeaders = [...headers.keys()].some(key => key.startsWith('x-toggly-'));
      const sdkAgent = headers.get('user-agent')?.startsWith('toggly-');
      if (sdkHeaders || sdkAgent) return new Response('{}', { status: 403 });
      return Response.json({ keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] });
    }
    definitionHeaders.push(headers);
    const defs = input.includes('/definitions-signed/')
      ? [{ featureKey: 'Enabled', filters: [{ name: 'AlwaysOn', parameters: {} }] }]
      : { Enabled: true };
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${JSON.stringify(defs)}|${timestamp}`));
    const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, digest)).toString('base64');
    return Response.json({ defs, timestamp, signature, kid });
  });
  const config = { appKey: 'public-jwks-fixture', baseURI: 'https://definitions.example', verifySignatures: true, flagDefaults: { Enabled: false }, enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
  const server = createTogglyServerClient(config);
  try {
    expect(await server.getFlag('Enabled')).toBe(true);
  } finally { await server.close(); }
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {});
  await initTogglyClient(config);
  expect($flags.get().Enabled).toBe(true);
  expect(jwksHeaders).toHaveLength(2);
  expect(jwksHeaders.every(headers => [...headers].length === 0)).toBe(true);
  expect(definitionHeaders[0].get('user-agent')).toMatch(/^toggly-astro\//);
  expect(definitionHeaders[1].get('x-toggly-sdk')).toBe('astro');
});
