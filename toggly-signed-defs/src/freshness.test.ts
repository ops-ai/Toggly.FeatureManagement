import { describe, expect, it } from 'vitest'
import { assertEnvelopeFreshness } from './freshness'

describe('assertEnvelopeFreshness', () => {
  it('no-ops when maxSignatureAgeSeconds is unset', () => {
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

  it('rejects envelopes older than maxSignatureAgeSeconds', () => {
    expect(() =>
      assertEnvelopeFreshness(100, {
        maxSignatureAgeSeconds: 300,
        nowSeconds: 1000,
      })
    ).toThrow(/maxSignatureAgeSeconds/)
  })

  it('accepts envelopes within age and skew', () => {
    expect(() =>
      assertEnvelopeFreshness(900, {
        maxSignatureAgeSeconds: 300,
        maxClockSkewSeconds: 60,
        nowSeconds: 1000,
      })
    ).not.toThrow()
    expect(() =>
      assertEnvelopeFreshness(1050, {
        maxSignatureAgeSeconds: 300,
        maxClockSkewSeconds: 60,
        nowSeconds: 1000,
      })
    ).not.toThrow()
  })
})
