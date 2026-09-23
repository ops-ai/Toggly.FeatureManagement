import { describe, it, expect } from 'vitest'
import {
  parseRemoteEvaluatedPayload,
  parseRemoteEvaluatedVariantsPayload,
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

describe('parseRemoteEvaluatedVariantsPayload', () => {
  it('unwraps a { defs } envelope into a variant-defs record', () => {
    expect(
      parseRemoteEvaluatedVariantsPayload({
        defs: {
          'new-checkout': { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
          'old-flag': { enabled: false },
        },
      }),
    ).toEqual({
      'new-checkout': { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
      'old-flag': { enabled: false },
    })
  })

  it('accepts an already-unwrapped (verified) bare defs map', () => {
    expect(
      parseRemoteEvaluatedVariantsPayload({
        a: { enabled: true, variant: 'control' },
      }),
    ).toEqual({ a: { enabled: true, variant: 'control' } })
  })

  it('coerces non-object / array payloads to an empty record', () => {
    expect(parseRemoteEvaluatedVariantsPayload(null)).toEqual({})
    expect(parseRemoteEvaluatedVariantsPayload([1, 2, 3])).toEqual({})
    expect(parseRemoteEvaluatedVariantsPayload('nope')).toEqual({})
  })

  it('throws on error envelopes', () => {
    expect(() => parseRemoteEvaluatedVariantsPayload({ error: 'boom' })).toThrow(
      /error envelope/i,
    )
  })
})

describe('variantDefsToFlags', () => {
  it('reduces variant defs to a boolean map keyed by enabled', () => {
    expect(
      variantDefsToFlags({
        a: { enabled: true, variant: 'treatment' },
        b: { enabled: false },
      }),
    ).toEqual({ a: true, b: false })
  })

  it('returns an empty map for an empty record', () => {
    expect(variantDefsToFlags({})).toEqual({})
  })
})
