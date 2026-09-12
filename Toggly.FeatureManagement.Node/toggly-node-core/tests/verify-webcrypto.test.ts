import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import fixture from './fixtures/webcrypto-fixture.json'
import workerFixture from './fixtures/worker-definitions.json'
import { createTogglyClient } from '../src/client'
import { parseSignedEnvelope, verifySignedDefinitions } from '../src/verify'

// This fixture was signed outside the Node SDK. Never replace its signature
// with one produced by the crypto.sign helper in verify.test.ts: a signer and
// verifier with the same hash-count bug can incorrectly pass a round-trip test.
describe('independent WebCrypto signature fixtures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts the externally generated canonical P1363 signature', () => {
    expect(() => verifySignedDefinitions(fixture.defs, fixture, fixture.jwks)).not.toThrow()
  })

  it('cross-checks the external fixture against the Worker WebCrypto operations', async () => {
    const key = await webcrypto.subtle.importKey(
      'jwk',
      fixture.jwks.keys[0],
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const digest = await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${fixture.defs}|${fixture.timestamp}`)
    )
    expect(await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      Buffer.from(fixture.signature, 'base64'),
      digest
    )).toBe(true)
  })

  it('accepts the same external signature encoded as DER without signing again', () => {
    // ECDSA encodings carry the same r/s values. DER INTEGERs are signed, so
    // remove redundant leading zeroes and pad positive high-bit values.
    const p1363 = Buffer.from(fixture.signature, 'base64')
    const integer = (bytes: Buffer): Buffer => {
      let offset = 0
      while (offset < bytes.length - 1 && bytes[offset] === 0) offset += 1
      let value = bytes.subarray(offset)
      if (value[0]! >= 0x80) value = Buffer.concat([Buffer.from([0]), value])
      return Buffer.concat([Buffer.from([0x02, value.length]), value])
    }
    const pair = Buffer.concat([integer(p1363.subarray(0, 32)), integer(p1363.subarray(32))])
    const signature = Buffer.concat([Buffer.from([0x30, pair.length]), pair]).toString('base64')
    expect(() => verifySignedDefinitions(fixture.defs, { ...fixture, signature }, fixture.jwks)).not.toThrow()
  })

  it('rejects altered or reserialized raw definitions', () => {
    for (const defs of [fixture.defs.replace('true', 'false'), JSON.stringify(JSON.parse(fixture.defs))]) {
      expect(() => verifySignedDefinitions(defs, fixture, fixture.jwks)).toThrow(/invalid signature/)
    }
  })

  it('rejects a changed timestamp or signature', () => {
    expect(() => verifySignedDefinitions(fixture.defs, {
      ...fixture, timestamp: fixture.timestamp + 1,
    }, fixture.jwks)).toThrow(/invalid signature/)
    const signature = Buffer.from(fixture.signature, 'base64')
    signature[0]! ^= 0xff
    expect(() => verifySignedDefinitions(fixture.defs, {
      ...fixture, signature: signature.toString('base64'),
    }, fixture.jwks)).toThrow(/invalid signature/)
  })

  it.each(['', 'not-a-signature', 'MAA=', Buffer.alloc(63).toString('base64')])(
    'rejects malformed signature %j',
    (signature) => {
      expect(() => verifySignedDefinitions(fixture.defs, { ...fixture, signature }, fixture.jwks)).toThrow()
    }
  )

  it('continues to enforce key identity and the allowed-key list', () => {
    expect(() => verifySignedDefinitions(fixture.defs, fixture, fixture.jwks, [fixture.kid])).not.toThrow()
    expect(() => verifySignedDefinitions(fixture.defs, fixture, fixture.jwks, ['untrusted'])).toThrow(/kid not allowed/)
    expect(() => verifySignedDefinitions(fixture.defs, { ...fixture, kid: 'unknown' }, fixture.jwks)).toThrow(/no matching jwk/)
    const invalidKey = { ...fixture.jwks.keys[0]!, x: workerFixture.jwks.keys[0]!.x }
    expect(() => verifySignedDefinitions(fixture.defs, fixture, { keys: [invalidKey] })).toThrow(/invalid kid/)
  })

  it('initializes and evaluates actual raw definitions after canonical verification', async () => {
    const body = `{"defs":${workerFixture.defs},"signature":"${workerFixture.signature}","timestamp":${workerFixture.timestamp},"kid":"${workerFixture.kid}"}`
    expect(parseSignedEnvelope(body).defsRaw).toBe(workerFixture.defs)
    vi.stubGlobal('fetch', async (url: string) => new Response(
      url.endsWith('/.well-known/jwks') ? JSON.stringify(workerFixture.jwks) : body,
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))
    const client = createTogglyClient({
      appKey: 'fixture-only',
      baseUrl: 'http://127.0.0.1:1',
      verifySignatures: true,
      allowedKeyIds: [workerFixture.kid],
      refreshInterval: 0,
      enableStreaming: false,
      enableUsageTracking: false,
      enableMetrics: false,
      registerContextsOnStartup: false,
    })
    try {
      await client.init()
      expect(client.state.error).toBeNull()
      expect(client.state.definitions.size).toBe(2)
      expect(await client.isFeatureOn('canonical-on')).toBe(true)
      expect(await client.isFeatureOn('canonical-off')).toBe(false)
    } finally {
      await client.close()
    }
  })
})
