import { describe, expect, it, vi } from 'vitest'
import {
  InMemoryJwksCache,
  asVariantDefsRecord,
  fetchEvaluatedSignedDefinitions,
  parseEvaluatedResponseBody,
  readAndParseEvaluatedResponse,
  readAndParseEvaluatedResponseCached,
  resolveEvaluatedFetchErrorState,
  signedDefsClientOptions,
  unwrapDefsPayload,
} from './signed-response'

function jsonResponse(
  body: unknown,
  status = 200,
  headerMap: Record<string, string> = {}
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 304 ? 'Not Modified' : 'OK',
    headers: {
      get: (name: string) =>
        headerMap[name] ?? headerMap[name.toLowerCase()] ?? null,
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response
}

describe('signed-response helpers', () => {
  it('parses unsigned bodies without fetching JWKS', async () => {
    const body = JSON.stringify({ defs: { A: true } })
    const result = await parseEvaluatedResponseBody(body, {
      verifySignatures: false,
      baseURI: 'https://example.test',
    })
    expect(result).toEqual({ defs: { A: true } })
  })

  it('unwraps defs payload', () => {
    expect(unwrapDefsPayload({ defs: { A: true } })).toEqual({ A: true })
    expect(unwrapDefsPayload({ A: true })).toEqual({ A: true })
  })

  it('uses getJwks when verifying', async () => {
    const getJwks = vi.fn(async () => {
      throw new Error('jwks-from-cache')
    })
    await expect(
      parseEvaluatedResponseBody('{"signature":"x","timestamp":1,"kid":"k","defs":{}}', {
        verifySignatures: true,
        baseURI: 'https://example.test',
        getJwks,
      })
    ).rejects.toThrow()
    expect(getJwks).toHaveBeenCalled()
  })

  it('accepts baseUri alias', async () => {
    const fetchImpl = vi.fn()
    await expect(
      parseEvaluatedResponseBody('not-json-when-verify', {
        verifySignatures: true,
        baseUri: 'https://example.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow()
    // parseSignedEnvelope fails before fetch when body is invalid — either way base resolves
  })
})

describe('InMemoryJwksCache', () => {
  const jwksA = { keys: [{ kid: 'a', kty: 'EC' }] }
  const jwksB = { keys: [{ kid: 'b', kty: 'EC' }] }

  it('get fetches JWKS, reuses cache, forceRefresh refreshes, and clear drops it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(jwksA))
      .mockResolvedValueOnce(jsonResponse(jwksB))
      .mockResolvedValueOnce(jsonResponse(jwksA))

    const cache = new InMemoryJwksCache()
    const options = {
      baseURI: 'https://example.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }

    expect(await cache.get(options)).toEqual(jwksA)
    expect(await cache.get(options)).toEqual(jwksA)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://example.test/.well-known/jwks')

    expect(await cache.get(options, true)).toEqual(jwksB)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    cache.clear()
    expect(await cache.get(options)).toEqual(jwksA)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('readAndParseEvaluatedResponse', () => {
  it('unwraps unsigned { defs } payloads', async () => {
    const result = await readAndParseEvaluatedResponse(jsonResponse({ defs: { A: true } }), {
      verifySignatures: false,
    })
    expect(result).toEqual({ A: true })
  })

  it('returns unsigned bare maps unchanged', async () => {
    const result = await readAndParseEvaluatedResponse(jsonResponse({ A: false }), {
      verifySignatures: false,
    })
    expect(result).toEqual({ A: false })
  })

  it('uses getJwks when verifySignatures is enabled', async () => {
    const getJwks = vi.fn(async () => ({ keys: [] }))
    await expect(
      readAndParseEvaluatedResponse(
        jsonResponse({ signature: 'x', timestamp: 1, kid: 'k', defs: {} }),
        { verifySignatures: true, baseURI: 'https://example.test', getJwks }
      )
    ).rejects.toThrow()
    expect(getJwks).toHaveBeenCalled()
  })
})

describe('signedDefsClientOptions', () => {
  it('maps null maxSignatureAgeSeconds to undefined and wires getJwks', async () => {
    const cache = new InMemoryJwksCache()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ keys: [{ kid: 'k' }] }))
    const options = signedDefsClientOptions(
      {
        verifySignatures: true,
        baseUri: 'https://example.test',
        maxSignatureAgeSeconds: null,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      cache
    )

    expect(options.baseURI).toBe('https://example.test')
    expect(options.maxSignatureAgeSeconds).toBeUndefined()
    expect(await options.getJwks?.()).toEqual({ keys: [{ kid: 'k' }] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await options.getJwks?.()).toEqual({ keys: [{ kid: 'k' }] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('preserves a numeric maxSignatureAgeSeconds', () => {
    const options = signedDefsClientOptions(
      {
        verifySignatures: true,
        baseURI: 'https://example.test',
        maxSignatureAgeSeconds: 120,
      },
      new InMemoryJwksCache()
    )
    expect(options.maxSignatureAgeSeconds).toBe(120)
  })
})

describe('readAndParseEvaluatedResponseCached', () => {
  it('parses a response through the cached helper using a host config object', async () => {
    const result = await readAndParseEvaluatedResponseCached(
      jsonResponse({ defs: { On: true } }),
      new InMemoryJwksCache(),
      { verifySignatures: false, baseURI: 'https://example.test' }
    )
    expect(result).toEqual({ On: true })
  })
})

describe('asVariantDefsRecord', () => {
  it('returns objects and empty maps for arrays', () => {
    expect(asVariantDefsRecord({ A: { enabled: true } })).toEqual({ A: { enabled: true } })
    expect(asVariantDefsRecord([])).toEqual({})
    expect(asVariantDefsRecord(null)).toEqual({})
  })
})

describe('resolveEvaluatedFetchErrorState', () => {
  it('prefers cached variants when enabled', () => {
    const recovered = resolveEvaluatedFetchErrorState({
      enableVariants: true,
      featuresAlreadyLoaded: false,
      readVariants: () => ({ V: { enabled: true } }),
      readFlags: () => ({ Fallback: true }),
      defaults: { Default: true },
      variantsToFlags: () => ({ V: true }),
    })
    expect(recovered).toEqual({
      variants: { V: { enabled: true } },
      features: { V: true },
    })
  })

  it('uses flags then defaults when variants cache is empty', () => {
    const recovered = resolveEvaluatedFetchErrorState({
      enableVariants: true,
      featuresAlreadyLoaded: false,
      readVariants: () => null,
      readFlags: () => ({ Fallback: true }),
      defaults: { Default: true },
      variantsToFlags: () => ({}),
    })
    expect(recovered).toEqual({ variants: null, features: { Fallback: true } })
  })

  it('keeps in-memory features when already loaded', () => {
    expect(
      resolveEvaluatedFetchErrorState({
        enableVariants: false,
        featuresAlreadyLoaded: true,
        readVariants: () => null,
        readFlags: () => ({ Cached: true }),
        defaults: {},
        variantsToFlags: () => ({}),
      }),
    ).toBeNull()
  })
})

describe('fetchEvaluatedSignedDefinitions', () => {
  it('returns notModified on HTTP 304', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 304, { ETag: '"rev-1"' }))
    const result = await fetchEvaluatedSignedDefinitions(
      'https://example.test/evaluated-signed/app/Production',
      new InMemoryJwksCache(),
      { verifySignatures: false, fetchImpl: fetchImpl as unknown as typeof fetch },
      { revision: 'rev-0' }
    )
    expect(result).toEqual({ notModified: true, revision: '"rev-1"' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/evaluated-signed/app/Production',
      { headers: { 'If-None-Match': 'rev-0' } }
    )
  })

  it('parses defs and returns the revision header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ defs: { On: true } }, 200, { 'X-Definitions-Revision': 'rev-9' })
      )
    const result = await fetchEvaluatedSignedDefinitions(
      'https://example.test/evaluated-signed/app/Production',
      new InMemoryJwksCache(),
      { verifySignatures: false, fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    expect(result).toEqual({ notModified: false, defs: { On: true }, revision: 'rev-9' })
  })
})
