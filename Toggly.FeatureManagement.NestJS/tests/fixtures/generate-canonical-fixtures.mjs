// Independent WebCrypto signer, matching the Definitions Worker contract at
// Toggly 9d08819a47d0b5a168a9b976f9396bc10c08f206 src/Toggly.Definitions/src/signer.ts.
// Private keys are ephemeral and never written; no SDK verifier/sign helper is used.
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const { subtle } = webcrypto;
const encoder = new TextEncoder();
const rule = (featureKey, name, parameters) => ({ featureKey, filters: [{ name, parameters }] });
async function generate(identity) {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  const coordinates = Buffer.concat([
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  const kid =
    Buffer.from(await subtle.digest('SHA-1', coordinates))
      .toString('hex')
      .toUpperCase() + 'ES256';
  const defs = JSON.stringify(
    [
      rule('target', 'Targeting', { 'Audience.Users:0': identity }),
      rule('claims', 'UserClaims', { Claim: 'role', Value: 'admin', Percentage: 100 }),
      rule('country', 'Country', { 'Country:0': 'US', Percentage: 100 }),
      rule('groups', 'Targeting', {
        'Audience.Groups:0:Name': 'staff',
        'Audience.Groups:0:RolloutPercentage': 100,
      }),
      {
        ...rule('vip', 'ContextProperty', {
          Property: 'Vip',
          Operator: 'eq',
          Value: 'true',
          ValueType: 'boolean',
        }),
        contextKind: 'Order',
      },
    ],
    null,
    2,
  );
  const timestamp = 1700000000;
  // One explicit digest plus ECDSA-SHA256's digest = canonical double hash.
  const digest = await subtle.digest('SHA-256', encoder.encode(`${defs}|${timestamp}`));
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, digest);
  return {
    defs,
    timestamp,
    signature: Buffer.from(signature).toString('base64'),
    kid,
    jwks: { keys: [{ ...jwk, alg: 'ES256', kid }] },
  };
}
writeFileSync(
  new URL('./canonical-worker.json', import.meta.url),
  JSON.stringify({ initial: await generate('alice'), rotated: await generate('bob') }, null, 2) +
    '\n',
);
