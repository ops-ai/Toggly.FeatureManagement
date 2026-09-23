import { describe, it, expect } from 'vitest'
import {
  parseRemoteEvaluatedPayload,
  parseVariantDefsPayload,
  variantDefsToFlags,
} from '../src/parse-evaluated-payload'

describe('parseRemoteEvaluatedPayload', () => {
  it('parses features[] envelopes', () => {
    expect(
      parseRemoteEvaluatedPayload({
        features: [
          { featureKey: 'a', enabled: true },
          { featureKey: 'b', enabled: false },
        ],
      }),
    ).toEqual({ a: true, b: false })
  })

  it('parses defs maps', () => {
    expect(
      parseRemoteEvaluatedPayload({ defs: { a: true, b: false } }),
    ).toEqual({ a: true, b: false })
  })

  it('parses bare boolean maps including empty', () => {
    expect(parseRemoteEvaluatedPayload({})).toEqual({})
    expect(parseRemoteEvaluatedPayload({ a: true })).toEqual({ a: true })
  })

  it('parses definition arrays via AlwaysOn', () => {
    expect(
      parseRemoteEvaluatedPayload([
        { featureKey: 'on', filters: [{ name: 'AlwaysOn' }] },
        { featureKey: 'off', filters: [] },
      ]),
    ).toEqual({ on: true, off: false })
  })

  it('throws on error envelopes', () => {
    expect(() => parseRemoteEvaluatedPayload({ error: 'boom' })).toThrow(
      /error envelope/i,
    )
  })

  it('throws on unsupported shapes', () => {
    expect(() => parseRemoteEvaluatedPayload(null)).toThrow(/Unsupported/i)
    expect(() => parseRemoteEvaluatedPayload('nope')).toThrow(/Unsupported/i)
    expect(() =>
      parseRemoteEvaluatedPayload({ nested: { still: 'bad' } }),
    ).toThrow(/Unsupported/i)
  })
})

describe('parseVariantDefsPayload', () => {
  it('unwraps a { defs } envelope (unverified path)', () => {
    expect(
      parseVariantDefsPayload({
        defs: { a: { enabled: true, variant: 'treatment' } },
      }),
    ).toEqual({ a: { enabled: true, variant: 'treatment' } })
  })

  it('accepts an already-unwrapped defs map (verified path)', () => {
    expect(
      parseVariantDefsPayload({ a: { enabled: false } }),
    ).toEqual({ a: { enabled: false } })
  })

  it('coerces arrays and primitives to an empty map', () => {
    expect(parseVariantDefsPayload([1, 2, 3])).toEqual({})
    expect(parseVariantDefsPayload('nope')).toEqual({})
    expect(parseVariantDefsPayload(null)).toEqual({})
  })

  it('throws on error envelopes without defs/features', () => {
    expect(() => parseVariantDefsPayload({ error: 'boom' })).toThrow(
      /error envelope/i,
    )
  })
})

describe('variantDefsToFlags', () => {
  it('derives a boolean map from variant defs', () => {
    expect(
      variantDefsToFlags({
        On: { enabled: true, variant: 'treatment' },
        Off: { enabled: false, variant: 'control' },
      }),
    ).toEqual({ On: true, Off: false })
  })

  it('treats missing/non-true enabled as false', () => {
    expect(variantDefsToFlags({})).toEqual({})
  })
})
