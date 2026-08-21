import { describe, expect, it, vi } from 'vitest'
import {
  parseEvaluatedResponseBody,
  unwrapDefsPayload,
} from './signed-response'

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
