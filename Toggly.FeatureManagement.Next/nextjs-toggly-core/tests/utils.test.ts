import { describe, it, expect } from 'vitest'
import {
  generateUUID,
  evaluateGate,
  deepMerge,
  normalizeFeatureKeys,
} from '../src/utils'
import { appendDefinitionsRevisionParam } from '../src/ws-sync'

describe('generateUUID', () => {
  it('should generate a valid UUID v4', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('should generate unique UUIDs', () => {
    const uuid1 = generateUUID()
    const uuid2 = generateUUID()
    expect(uuid1).not.toBe(uuid2)
  })
})

describe('evaluateGate', () => {
  const features = {
    'feature-a': true,
    'feature-b': true,
    'feature-c': false,
  }

  describe('all requirement', () => {
    it('should return true when all features are enabled', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-b'], 'all')).toBe(
        true
      )
    })

    it('should return false when not all features are enabled', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-c'], 'all')).toBe(
        false
      )
    })

    it('should return true for empty feature array', () => {
      expect(evaluateGate(features, [], 'all')).toBe(true)
    })
  })

  describe('any requirement', () => {
    it('should return true when any feature is enabled', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-c'], 'any')).toBe(
        true
      )
    })

    it('should return false when no features are enabled', () => {
      expect(evaluateGate(features, ['feature-c'], 'any')).toBe(false)
    })

    it('should return false for empty feature array with any', () => {
      expect(evaluateGate(features, [], 'any')).toBe(true)
    })
  })

  describe('negate', () => {
    it('should negate the result when negate is true', () => {
      expect(evaluateGate(features, ['feature-a'], 'all', true)).toBe(false)
      expect(evaluateGate(features, ['feature-c'], 'all', true)).toBe(true)
    })
  })
})

describe('deepMerge', () => {
  it('should merge simple objects', () => {
    const target = { a: 1, b: 2 }
    const source = { b: 3, c: 4 }
    const result = deepMerge(target, source)

    expect(result).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('should deep merge nested objects', () => {
    const target = { a: { b: 1, c: 2 } }
    const source = { a: { c: 3, d: 4 } }
    const result = deepMerge(target, source)

    expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } })
  })

  it('should not mutate original objects', () => {
    const target = { a: 1 }
    const source = { b: 2 }
    const result = deepMerge(target, source)

    expect(target).toEqual({ a: 1 })
    expect(source).toEqual({ b: 2 })
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it('should handle arrays as values (not merge)', () => {
    const target = { a: [1, 2] }
    const source = { a: [3, 4] }
    const result = deepMerge(target, source)

    expect(result).toEqual({ a: [3, 4] })
  })
})

describe('normalizeFeatureKeys', () => {
  it('should convert string to array', () => {
    expect(normalizeFeatureKeys('feature-a')).toEqual(['feature-a'])
  })

  it('should return array as-is', () => {
    expect(normalizeFeatureKeys(['feature-a', 'feature-b'])).toEqual([
      'feature-a',
      'feature-b',
    ])
  })
})


describe('appendDefinitionsRevisionParam', () => {
  it('sets rev on absolute URLs', () => {
    expect(appendDefinitionsRevisionParam('https://definitions.toggly.io/a/b', 'e1')).toBe(
      'https://definitions.toggly.io/a/b?rev=e1',
    )
  })
})
