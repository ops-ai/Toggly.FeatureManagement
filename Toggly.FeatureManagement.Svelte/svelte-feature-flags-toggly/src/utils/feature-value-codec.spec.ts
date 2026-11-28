import { describe, it, expect } from 'vitest'
import {
  decodeDateTimeValue,
  decodeJsonValue,
  decodeNumberValue,
  decodeStringValue,
  isFeatureValueType,
  valueTypeMatches,
} from './feature-value-codec'

describe('feature-value-codec', () => {
  describe('isFeatureValueType', () => {
    it('accepts the known value types', () => {
      expect(isFeatureValueType('boolean')).toBe(true)
      expect(isFeatureValueType('string')).toBe(true)
      expect(isFeatureValueType('number')).toBe(true)
      expect(isFeatureValueType('json')).toBe(true)
      expect(isFeatureValueType('datetime')).toBe(true)
    })

    it('rejects unknown or non-string values', () => {
      expect(isFeatureValueType('variant')).toBe(false)
      expect(isFeatureValueType(undefined)).toBe(false)
      expect(isFeatureValueType(null)).toBe(false)
      expect(isFeatureValueType(42)).toBe(false)
    })
  })

  describe('valueTypeMatches', () => {
    it('matches declared valueType strictly when present', () => {
      expect(valueTypeMatches('string', 'string')).toBe(true)
      expect(valueTypeMatches('number', 'string')).toBe(false)
    })

    it('allows a decode attempt for legacy catalogs missing valueType', () => {
      expect(valueTypeMatches(undefined, 'string')).toBe(true)
      expect(valueTypeMatches(null, 'string')).toBe(true)
      expect(valueTypeMatches('' as never, 'string')).toBe(true)
    })
  })

  describe('decodeStringValue', () => {
    it('decodes a matching string', () => {
      expect(decodeStringValue('hello', 'string')).toBe('hello')
    })

    it('soft-nulls on shape mismatch', () => {
      expect(decodeStringValue(1, 'string')).toBeNull()
    })

    it('soft-nulls on declared valueType mismatch', () => {
      expect(decodeStringValue('hello', 'number')).toBeNull()
    })
  })

  describe('decodeNumberValue', () => {
    it('decodes a finite number', () => {
      expect(decodeNumberValue(3.14, 'number')).toBe(3.14)
    })

    it('decodes a numeric string', () => {
      expect(decodeNumberValue('42', 'number')).toBe(42)
    })

    it('soft-nulls non-numeric strings and NaN/Infinity', () => {
      expect(decodeNumberValue('x', 'number')).toBeNull()
      expect(decodeNumberValue(NaN, 'number')).toBeNull()
      expect(decodeNumberValue(Infinity, 'number')).toBeNull()
    })

    it('soft-nulls on declared valueType mismatch', () => {
      expect(decodeNumberValue(42, 'string')).toBeNull()
    })
  })

  describe('decodeJsonValue', () => {
    it('decodes an object or array as-is', () => {
      expect(decodeJsonValue({ a: 1 }, 'json')).toEqual({ a: 1 })
      expect(decodeJsonValue([1, 2], 'json')).toEqual([1, 2])
    })

    it('parses a JSON string payload into an object/array', () => {
      expect(decodeJsonValue('{"a":1}', 'json')).toEqual({ a: 1 })
      expect(decodeJsonValue('[1,2]', 'json')).toEqual([1, 2])
    })

    it('soft-nulls invalid JSON, primitives, and nullish raw values', () => {
      expect(decodeJsonValue('not-json', 'json')).toBeNull()
      expect(decodeJsonValue('"just a string"', 'json')).toBeNull()
      expect(decodeJsonValue(null, 'json')).toBeNull()
      expect(decodeJsonValue(undefined, 'json')).toBeNull()
      expect(decodeJsonValue(42, 'json')).toBeNull()
    })

    it('soft-nulls on declared valueType mismatch', () => {
      expect(decodeJsonValue({ a: 1 }, 'string')).toBeNull()
    })
  })

  describe('decodeDateTimeValue', () => {
    it('decodes an ISO-8601 string to a Date', () => {
      const iso = '2026-11-28T12:00:00.000Z'
      const d = decodeDateTimeValue(iso, 'datetime')
      expect(d).toBeInstanceOf(Date)
      expect(d!.toISOString()).toBe(iso)
    })

    it('passes through an existing valid Date', () => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      expect(decodeDateTimeValue(date, 'datetime')).toBe(date)
    })

    it('decodes a numeric epoch millis value', () => {
      const ms = 1_700_000_000_000
      const d = decodeDateTimeValue(ms, 'datetime')
      expect(d).toBeInstanceOf(Date)
      expect(d!.getTime()).toBe(ms)
    })

    it('soft-nulls invalid dates and declared valueType mismatch', () => {
      expect(decodeDateTimeValue('not-a-date', 'datetime')).toBeNull()
      expect(decodeDateTimeValue(new Date('invalid'), 'datetime')).toBeNull()
      expect(decodeDateTimeValue('2026-11-28T12:00:00.000Z', 'string')).toBeNull()
    })

    it('soft-nulls an epoch millis value outside the representable Date range', () => {
      expect(decodeDateTimeValue(8.64e15 + 1, 'datetime')).toBeNull()
    })

    it('soft-nulls other primitive shapes and whitespace-only strings', () => {
      expect(decodeDateTimeValue(true, 'datetime')).toBeNull()
      expect(decodeDateTimeValue('   ', 'datetime')).toBeNull()
    })
  })
})
