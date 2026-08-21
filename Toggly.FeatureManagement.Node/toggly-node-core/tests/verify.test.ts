import { describe, it, expect } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  assertEnvelopeFreshness,
  extractRawJsonProperty,
  parseSignedEnvelope,
  parseDefinitionsFromRaw,
  verifySignedDefinitions,
  validateAndParseEs256Key,
  type Jwk,
  type JwkSet,
} from '../src/verify'

function computeKid(x: string, y: string): string {
  const xBytes = Buffer.from(x, 'base64url')
  const yBytes = Buffer.from(y, 'base64url')
  const digest = createHash('sha1').update(xBytes).update(yBytes).digest('hex').toUpperCase()
  return `${digest}ES256`
}

function doubleSha256(payload: string): Buffer {
  const first = createHash('sha256').update(payload, 'utf8').digest()
  return createHash('sha256').update(first).digest()
}

function makeSignedKey(): {
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  jwk: Jwk
} {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwkExport = publicKey.export({ format: 'jwk' }) as {
    x?: string
    y?: string
  }
  const x = jwkExport.x!
  const y = jwkExport.y!
  const kid = computeKid(x, y)
  const jwk: Jwk = {
    kty: 'EC',
    use: 'sig',
    alg: 'ES256',
    crv: 'P-256',
    x,
    y,
    kid,
  }
  return { privateKey, jwk }
}

function signP1363(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  hash: Buffer
): Buffer {
  return sign(null, hash, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
}

function signDer(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  hash: Buffer
): Buffer {
  return sign(null, hash, {
    key: privateKey,
    dsaEncoding: 'der',
  })
}

describe('extractRawJsonProperty', () => {
  it('extracts exact defs bytes including compact formatting', () => {
    const body = '{"defs":{"a":1},"signature":"x","timestamp":1,"kid":"k"}'
    expect(extractRawJsonProperty(body, 'defs')).toBe('{"a":1}')
  })

  it('preserves whitespace inside defs', () => {
    const body = '{"defs":{\n  "a": 1\n},"signature":"x","timestamp":1,"kid":"k"}'
    expect(extractRawJsonProperty(body, 'defs')).toBe('{\n  "a": 1\n}')
  })

  it('ignores nested defs under data', () => {
    const body =
      '{"data":{"defs":{"innocent":true}},"defs":{"Evil":true},"signature":"x","timestamp":1,"kid":"k"}'
    expect(extractRawJsonProperty(body, 'defs')).toBe('{"Evil":true}')
  })
})

describe('verifySignedDefinitions', () => {
  it('verifies a valid P1363 signature over raw defs', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '[{"featureKey":"demo","filters":[{"name":"AlwaysOn","parameters":{}}]}]'
    const timestamp = 1730000000
    const payload = `${defs}|${timestamp}`
    const signature = signP1363(privateKey, doubleSha256(payload)).toString('base64')

    expect(() =>
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).not.toThrow()
  })

  it('accepts DER signatures (Key Vault style)', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '{"PresalePhotos":true}'
    const timestamp = 1783915396
    const signature = signDer(privateKey, doubleSha256(`${defs}|${timestamp}`)).toString(
      'base64'
    )

    expect(() =>
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).not.toThrow()
  })

  it('rejects re-serialized defs (different bytes)', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const compact = '{"a":1}'
    const timestamp = 100
    const signature = signP1363(
      privateKey,
      doubleSha256(`${compact}|${timestamp}`)
    ).toString('base64')

    expect(() =>
      verifySignedDefinitions(compact, { signature, timestamp, kid: jwk.kid }, jwks)
    ).not.toThrow()

    const pretty = '{\n  "a": 1\n}'
    expect(() =>
      verifySignedDefinitions(pretty, { signature, timestamp, kid: jwk.kid }, jwks)
    ).toThrow(/invalid signature/)
  })

  it('rejects bad signatures', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '[]'
    const timestamp = 1730000000
    const sig = Buffer.from(signP1363(privateKey, doubleSha256(`${defs}|${timestamp}`)))
    sig[0] ^= 0xff

    expect(() =>
      verifySignedDefinitions(
        defs,
        { signature: sig.toString('base64'), timestamp, kid: jwk.kid },
        jwks
      )
    ).toThrow(/invalid signature/)
  })

  it('rejects single-SHA256 signatures (Web Crypto production mismatch)', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '{"PresalePhotos":true}'
    const timestamp = 1783915396
    const singleHash = createHash('sha256').update(`${defs}|${timestamp}`, 'utf8').digest()
    const signature = signP1363(privateKey, singleHash).toString('base64')

    expect(() =>
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks)
    ).toThrow(/invalid signature/)
  })

  it('enforces allowedKeyIds', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '[]'
    const timestamp = 1
    const signature = signP1363(
      privateKey,
      doubleSha256(`${defs}|${timestamp}`)
    ).toString('base64')

    expect(() =>
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks, [jwk.kid])
    ).not.toThrow()

    expect(() =>
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks, ['nope'])
    ).toThrow(/kid not allowed/)
  })

  it('rejects stale envelopes when maxSignatureAgeSeconds is set', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '[]'
    const timestamp = 100
    const signature = signP1363(
      privateKey,
      doubleSha256(`${defs}|${timestamp}`)
    ).toString('base64')

    expect(() =>
      verifySignedDefinitions(defs, { signature, timestamp, kid: jwk.kid }, jwks, undefined, {
        maxSignatureAgeSeconds: 300,
        nowSeconds: 1000,
      })
    ).toThrow(/maxSignatureAgeSeconds/)
  })

  it('parseSignedEnvelope keeps raw defs for verify and apply', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const defs = '{"feature-a":true}'
    const timestamp = 42
    const signature = signP1363(
      privateKey,
      doubleSha256(`${defs}|${timestamp}`)
    ).toString('base64')
    const body = `{"defs":${defs},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`

    const { envelope, defsRaw } = parseSignedEnvelope(body)
    expect(defsRaw).toBe(defs)
    verifySignedDefinitions(defsRaw, envelope, jwks)
    expect(parseDefinitionsFromRaw(defsRaw)).toEqual({ 'feature-a': true })
  })

  it('nested innocent defs cannot authenticate unsigned outer defs', () => {
    const { privateKey, jwk } = makeSignedKey()
    const jwks: JwkSet = { keys: [jwk] }
    const innocent = '{"innocent":true}'
    const evil = '{"Evil":true}'
    const timestamp = 99
    // Signature covers nested/innocent bytes only.
    const signature = signP1363(
      privateKey,
      doubleSha256(`${innocent}|${timestamp}`)
    ).toString('base64')
    const body = `{"data":{"defs":${innocent}},"defs":${evil},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`

    const { envelope, defsRaw } = parseSignedEnvelope(body)
    expect(defsRaw).toBe(evil)
    expect(() => verifySignedDefinitions(defsRaw, envelope, jwks)).toThrow(/invalid signature/)
    // Callers must apply defsRaw after verify — never envelope.defs from a forged body alone.
    expect(parseDefinitionsFromRaw(defsRaw)).toEqual({ Evil: true })
  })

  it('rejects empty signature or kid in the envelope', () => {
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"","timestamp":1,"kid":"k"}')
    ).toThrow(/Invalid signed definitions envelope/)
    expect(() =>
      parseSignedEnvelope('{"defs":{"a":1},"signature":"x","timestamp":1,"kid":""}')
    ).toThrow(/Invalid signed definitions envelope/)
  })
})

describe('validateAndParseEs256Key', () => {
  it('rejects wrong alg', () => {
    expect(() =>
      validateAndParseEs256Key({
        kty: 'EC',
        kid: 'x',
        alg: 'RS256',
        crv: 'P-256',
        x: 'a',
        y: 'b',
      })
    ).toThrow(/unsupported alg/)
  })
})

describe('assertEnvelopeFreshness', () => {
  it('no-ops when maxSignatureAgeSeconds is unset or <= 0', () => {
    expect(() => assertEnvelopeFreshness(1)).not.toThrow()
    expect(() => assertEnvelopeFreshness(1, {})).not.toThrow()
    expect(() => assertEnvelopeFreshness(1, { maxSignatureAgeSeconds: 0 })).not.toThrow()
  })

  it('rejects non-finite timestamps when freshness is enabled', () => {
    expect(() =>
      assertEnvelopeFreshness(Number.NaN, { maxSignatureAgeSeconds: 300, nowSeconds: 1000 })
    ).toThrow(/invalid signature timestamp/)
  })

  it('rejects timestamps too far in the future', () => {
    expect(() =>
      assertEnvelopeFreshness(2000, {
        maxSignatureAgeSeconds: 300,
        maxClockSkewSeconds: 60,
        nowSeconds: 1000,
      })
    ).toThrow(/in the future/)
  })

  it('accepts envelopes within age and skew', () => {
    expect(() =>
      assertEnvelopeFreshness(900, {
        maxSignatureAgeSeconds: 300,
        maxClockSkewSeconds: 60,
        nowSeconds: 1000,
      })
    ).not.toThrow()
  })
})
