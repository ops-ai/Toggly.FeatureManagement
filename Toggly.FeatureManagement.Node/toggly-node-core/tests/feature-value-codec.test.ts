import { describe, it, expect } from 'vitest'
import {
  decodeDateTimeValue,
  decodeJsonValue,
  decodeNumberValue,
  decodeStringValue,
  valueTypeMatches,
} from '../src/feature-value-codec'

describe('feature-value-codec (OPS-2102)', () => {
  it('valueTypeMatches allows legacy (missing) declared types and rejects mismatches', () => {
    expect(valueTypeMatches(undefined, 'string')).toBe(true)
    expect(valueTypeMatches(null, 'string')).toBe(true)
    expect(valueTypeMatches('string', 'string')).toBe(true)
    expect(valueTypeMatches('number', 'string')).toBe(false)
  })

  it('decodeStringValue soft-nulls on mismatch or non-string input', () => {
    expect(decodeStringValue('dark', 'string')).toBe('dark')
    expect(decodeStringValue('dark', undefined)).toBe('dark')
    expect(decodeStringValue(42, 'string')).toBeNull()
    expect(decodeStringValue('dark', 'number')).toBeNull()
  })

  it('decodeNumberValue accepts numbers and numeric strings, never booleans', () => {
    expect(decodeNumberValue(42, 'number')).toBe(42)
    expect(decodeNumberValue('3.14', 'number')).toBe(3.14)
    expect(decodeNumberValue(true, 'number')).toBeNull()
    expect(decodeNumberValue('not-a-number', 'number')).toBeNull()
    expect(decodeNumberValue(42, 'string')).toBeNull()
  })

  it('decodeJsonValue accepts objects/arrays and JSON strings only', () => {
    expect(decodeJsonValue({ a: 1 }, 'json')).toEqual({ a: 1 })
    expect(decodeJsonValue('{"a":1}', 'json')).toEqual({ a: 1 })
    expect(decodeJsonValue('not json', 'json')).toBeNull()
    expect(decodeJsonValue('"a plain string"', 'json')).toBeNull()
    expect(decodeJsonValue({ a: 1 }, 'string')).toBeNull()
  })

  it('decodeDateTimeValue parses ISO-8601 strings and soft-nulls otherwise', () => {
    const decoded = decodeDateTimeValue('2026-01-15T10:30:00Z', 'datetime')
    expect(decoded).toBeInstanceOf(Date)
    expect(decoded?.toISOString()).toBe('2026-01-15T10:30:00.000Z')
    expect(decodeDateTimeValue('not-a-date', 'datetime')).toBeNull()
    expect(decodeDateTimeValue('2026-01-15T10:30:00Z', 'string')).toBeNull()
  })
})
