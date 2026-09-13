// Regenerate the public raw-definitions fixture using the Worker's WebCrypto
// operations, independently of the Node verifier. The ephemeral private key
// stays in memory: only the public JWK and signature are written to disk.
import { webcrypto } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const { subtle } = webcrypto
const keys = await subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
)
const publicJwk = await subtle.exportKey('jwk', keys.publicKey)
const coordinates = Buffer.concat([
  Buffer.from(publicJwk.x, 'base64url'),
  Buffer.from(publicJwk.y, 'base64url'),
])
const kidHash = await subtle.digest('SHA-1', coordinates)
const kid = `${Buffer.from(kidHash).toString('hex').toUpperCase()}ES256`
const defs = '[\n  {"featureKey":"canonical-on","filters":[{"name":"AlwaysOn","parameters":{}}]},\n  {"featureKey":"canonical-off","filters":[]}\n]'
const timestamp = 1700000000
const digest = await subtle.digest(
  'SHA-256',
  new TextEncoder().encode(`${defs}|${timestamp}`)
)
const signature = await subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  keys.privateKey,
  digest
)
const fixture = {
  defs,
  timestamp,
  signature: Buffer.from(signature).toString('base64'),
  kid,
  jwks: { keys: [{ ...publicJwk, alg: 'ES256', kid }] },
}
writeFileSync(new URL('./worker-definitions.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`)
