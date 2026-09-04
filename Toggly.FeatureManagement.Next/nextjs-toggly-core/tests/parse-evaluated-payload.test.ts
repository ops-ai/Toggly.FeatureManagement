import { describe, it, expect } from 'vitest'
import { parseRemoteEvaluatedPayload } from '../src/parse-evaluated-payload'

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
