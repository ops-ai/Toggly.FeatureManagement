import { createHash, generateKeyPairSync, sign, webcrypto } from 'crypto'
import Toggly from './toggly.service'

if (!(globalThis as any).crypto?.subtle) {
  ;(globalThis as any).crypto = webcrypto as any
}

const mockFetch = jest.fn()
;(global as any).fetch = mockFetch

function computeKidSync(x: string, y: string): string {
  const xBytes = Buffer.from(x, 'base64url')
  const yBytes = Buffer.from(y, 'base64url')
  const digest = createHash('sha1').update(xBytes).update(yBytes).digest('hex').toUpperCase()
  return `${digest}ES256`
}

function doubleSha256(payload: string): Buffer {
  const first = createHash('sha256').update(payload, 'utf8').digest()
  return createHash('sha256').update(first).digest()
}

function makeSignedKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwkExport = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const kid = computeKidSync(jwkExport.x, jwkExport.y)
  return {
    privateKey,
    jwk: {
      kty: 'EC',
      use: 'sig',
      alg: 'ES256',
      crv: 'P-256',
      x: jwkExport.x,
      y: jwkExport.y,
      kid,
    },
  }
}

describe('Toggly verifySignatures integration', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('rejects kids outside allowedKeyIds', async () => {
    const { privateKey, jwk } = makeSignedKey()
    const defs = '{"FeatureA":true}'
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = sign(null, doubleSha256(`${defs}|${timestamp}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64')
    const body = `{"defs":${defs},"signature":"${signature}","timestamp":${timestamp},"kid":"${jwk.kid}"}`

    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/.well-known/jwks')) {
        return {
          ok: true,
          json: async () => ({ keys: [jwk] }),
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => body,
        json: async () => JSON.parse(body),
      }
    })

    const service = new Toggly({
      appKey: 'app',
      environment: 'Production',
      baseURI: 'https://definitions.test',
      verifySignatures: true,
      allowedKeyIds: ['some-other-kid'],
      persistCache: false,
      enableLiveUpdates: false,
      featureDefaults: { FeatureA: false },
    })

    await service._loadFeatures()
    expect(await service.isFeatureOn('FeatureA')).toBe(false)
  })
})
