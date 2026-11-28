import { describe, expect, it } from 'vitest'
import {
  decodeDateTimeValue,
  decodeJsonValue,
  decodeNumberValue,
  decodeStringValue,
  valueTypeMatches,
} from './feature-value-codec'

describe('feature-value-codec', () => {
  it('matches declared valueType strictly when present', () => {
    expect(valueTypeMatches('string', 'string')).toBe(true)
    expect(valueTypeMatches('number', 'string')).toBe(false)
    expect(valueTypeMatches(undefined, 'string')).toBe(true)
  })

  it('decodes string', () => {
    expect(decodeStringValue('hello', 'string')).toBe('hello')
    expect(decodeStringValue(1, 'string')).toBeNull()
    expect(decodeStringValue('hello', 'number')).toBeNull()
  })

  it('decodes number', () => {
    expect(decodeNumberValue(3.14, 'number')).toBe(3.14)
    expect(decodeNumberValue('42', 'number')).toBe(42)
    expect(decodeNumberValue('x', 'number')).toBeNull()
  })

  it('decodes json object/array', () => {
    expect(decodeJsonValue({ a: 1 }, 'json')).toEqual({ a: 1 })
    expect(decodeJsonValue([1], 'json')).toEqual([1])
    expect(decodeJsonValue('{"a":1}', 'json')).toEqual({ a: 1 })
    expect(decodeJsonValue('nope', 'json')).toBeNull()
    expect(decodeJsonValue('hello', 'json')).toBeNull()
  })

  it('decodes datetime to Date', () => {
    const iso = '2026-11-28T12:00:00.000Z'
    const d = decodeDateTimeValue(iso, 'datetime')
    expect(d).toBeInstanceOf(Date)
    expect(d!.toISOString()).toBe(iso)
    expect(decodeDateTimeValue('not-a-date', 'datetime')).toBeNull()
    expect(decodeDateTimeValue(iso, 'string')).toBeNull()
  })
})
