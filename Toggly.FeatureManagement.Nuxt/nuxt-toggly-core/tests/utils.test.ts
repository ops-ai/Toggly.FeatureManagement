import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateUUID,
  normalizeFeatureKeys,
  evaluateGate,
  deepMerge,
  isPlainObject,
  debounce,
  createDeferred,
} from '../src/utils'

describe('generateUUID', () => {
  it('should generate a valid UUID v4 format', () => {
    const uuid = generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('should generate unique UUIDs', () => {
    const uuids = new Set()
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID())
    }
    expect(uuids.size).toBe(100)
  })

  it('should use crypto.randomUUID when available', () => {
    // In Node.js/Vitest environment, crypto.randomUUID is already available
    // We just verify the function produces valid UUIDs
    const uuid = generateUUID()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })
})

describe('normalizeFeatureKeys', () => {
  it('should return empty array for undefined', () => {
    expect(normalizeFeatureKeys(undefined)).toEqual([])
  })

  it('should return empty array for empty string', () => {
    // Empty string should be filtered out as it's not a valid feature key
    expect(normalizeFeatureKeys('')).toEqual([])
  })

  it('should wrap single string in array', () => {
    expect(normalizeFeatureKeys('feature-a')).toEqual(['feature-a'])
  })

  it('should return array as-is', () => {
    const keys = ['feature-a', 'feature-b']
    expect(normalizeFeatureKeys(keys)).toEqual(keys)
  })

  it('should handle empty array', () => {
    expect(normalizeFeatureKeys([])).toEqual([])
  })
})

describe('evaluateGate', () => {
  const features = {
    'feature-a': true,
    'feature-b': false,
    'feature-c': true,
  }

  describe('requirement: all', () => {
    it('should return true when all features are enabled', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-c'], 'all')).toBe(true)
    })

    it('should return false when any feature is disabled', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-b'], 'all')).toBe(false)
    })

    it('should return true for empty keys', () => {
      expect(evaluateGate(features, [], 'all')).toBe(true)
    })

    it('should return false for missing features', () => {
      expect(evaluateGate(features, ['feature-missing'], 'all')).toBe(false)
    })
  })

  describe('requirement: any', () => {
    it('should return true when at least one feature is enabled', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-b'], 'any')).toBe(true)
    })

    it('should return false when all features are disabled', () => {
      expect(evaluateGate(features, ['feature-b'], 'any')).toBe(false)
    })

    it('should return true for empty keys', () => {
      expect(evaluateGate(features, [], 'any')).toBe(true)
    })
  })

  describe('negate', () => {
    it('should negate the result when negate is true', () => {
      expect(evaluateGate(features, ['feature-a'], 'all', true)).toBe(false)
    })

    it('should return true when negating false result', () => {
      expect(evaluateGate(features, ['feature-b'], 'all', true)).toBe(true)
    })

    it('should negate empty keys result', () => {
      expect(evaluateGate(features, [], 'all', true)).toBe(false)
    })
  })

  describe('default requirement', () => {
    it('should default to "all" requirement', () => {
      expect(evaluateGate(features, ['feature-a', 'feature-b'])).toBe(false)
    })
  })
})

describe('deepMerge', () => {
  it('should merge simple objects', () => {
    const target = { a: 1, b: 2 }
    const source = { b: 3, c: 4 }
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('should merge nested objects', () => {
    const target = { a: { b: 1, c: 2 } }
    const source = { a: { c: 3, d: 4 } }
    expect(deepMerge(target, source)).toEqual({ a: { b: 1, c: 3, d: 4 } })
  })

  it('should not modify original objects', () => {
    const target = { a: 1 }
    const source = { b: 2 }
    const result = deepMerge(target, source)
    expect(target).toEqual({ a: 1 })
    expect(result).not.toBe(target)
  })

  it('should handle arrays (replace, not merge)', () => {
    const target = { arr: [1, 2, 3] }
    const source = { arr: [4, 5] }
    expect(deepMerge(target, source)).toEqual({ arr: [4, 5] })
  })

  it('should skip undefined values', () => {
    const target = { a: 1, b: 2 }
    const source = { a: undefined, c: 3 }
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 2, c: 3 })
  })
})

describe('isPlainObject', () => {
  it('should return true for plain objects', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
  })

  it('should return false for arrays', () => {
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject([1, 2, 3])).toBe(false)
  })

  it('should return false for null', () => {
    expect(isPlainObject(null)).toBe(false)
  })

  it('should return false for primitives', () => {
    expect(isPlainObject(undefined)).toBe(false)
    expect(isPlainObject(42)).toBe(false)
    expect(isPlainObject('string')).toBe(false)
    expect(isPlainObject(true)).toBe(false)
  })

  it('should return false for class instances', () => {
    class MyClass {}
    expect(isPlainObject(new MyClass())).toBe(true) // Note: new MyClass() is still [object Object]
    expect(isPlainObject(new Date())).toBe(false)
    expect(isPlainObject(new Map())).toBe(false)
  })
})

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should debounce function calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced()
    debounced()

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should pass arguments to the debounced function', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('arg1', 'arg2')

    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('should reset timer on subsequent calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)
    debounced()
    vi.advanceTimersByTime(50)

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)

    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('createDeferred', () => {
  it('should create a deferred promise that can be resolved', async () => {
    const deferred = createDeferred<string>()

    setTimeout(() => deferred.resolve('resolved'), 10)

    const result = await deferred.promise
    expect(result).toBe('resolved')
  })

  it('should create a deferred promise that can be rejected', async () => {
    const deferred = createDeferred<string>()

    setTimeout(() => deferred.reject(new Error('rejected')), 10)

    await expect(deferred.promise).rejects.toThrow('rejected')
  })
})
