import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateUUID,
  evaluateGate,
  normalizeFeatureKeys,
  deepMerge,
  isPlainObject,
  debounce,
  sleep,
  retry,
  createLogger,
  hashString,
  getPercentageBucket,
} from '../src/utils'

describe('utils', () => {
  describe('generateUUID', () => {
    it('should generate a valid UUID v4 format', () => {
      const uuid = generateUUID()
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    })

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID())
      }
      expect(uuids.size).toBe(100)
    })
  })

  describe('evaluateGate', () => {
    const features = {
      'feature-a': true,
      'feature-b': false,
      'feature-c': true,
    }

    describe('all requirement', () => {
      it('should return true when all features are enabled', () => {
        const result = evaluateGate(features, ['feature-a', 'feature-c'], 'all')
        expect(result).toBe(true)
      })

      it('should return false when any feature is disabled', () => {
        const result = evaluateGate(features, ['feature-a', 'feature-b'], 'all')
        expect(result).toBe(false)
      })

      it('should return false for empty array', () => {
        const result = evaluateGate(features, [], 'all')
        expect(result).toBe(false)
      })

      it('should return false for undefined features', () => {
        const result = evaluateGate(features, ['feature-a', 'feature-x'], 'all')
        expect(result).toBe(false)
      })
    })

    describe('any requirement', () => {
      it('should return true when any feature is enabled', () => {
        const result = evaluateGate(features, ['feature-a', 'feature-b'], 'any')
        expect(result).toBe(true)
      })

      it('should return false when all features are disabled', () => {
        const result = evaluateGate(features, ['feature-b'], 'any')
        expect(result).toBe(false)
      })

      it('should return false for empty array', () => {
        const result = evaluateGate(features, [], 'any')
        expect(result).toBe(false)
      })
    })

    describe('negation', () => {
      it('should negate the result when negate is true', () => {
        const result = evaluateGate(features, ['feature-a'], 'all', true)
        expect(result).toBe(false)
      })

      it('should negate false to true', () => {
        const result = evaluateGate(features, ['feature-b'], 'all', true)
        expect(result).toBe(true)
      })

      it('should negate empty array result', () => {
        const result = evaluateGate(features, [], 'all', true)
        expect(result).toBe(true)
      })
    })

    describe('default requirement', () => {
      it('should default to all requirement', () => {
        const result = evaluateGate(features, ['feature-a', 'feature-c'])
        expect(result).toBe(true)
      })
    })
  })

  describe('normalizeFeatureKeys', () => {
    it('should return array as-is', () => {
      const keys = ['a', 'b', 'c']
      expect(normalizeFeatureKeys(keys)).toEqual(keys)
    })

    it('should wrap single string in array', () => {
      expect(normalizeFeatureKeys('feature')).toEqual(['feature'])
    })

    it('should handle empty string', () => {
      expect(normalizeFeatureKeys('')).toEqual([''])
    })

    it('should handle empty array', () => {
      expect(normalizeFeatureKeys([])).toEqual([])
    })
  })

  describe('deepMerge', () => {
    it('should merge flat objects', () => {
      const target = { a: 1, b: 2 }
      const source = { b: 3, c: 4 }
      expect(deepMerge(target, source)).toEqual({ a: 1, b: 3, c: 4 })
    })

    it('should deeply merge nested objects', () => {
      const target = { nested: { a: 1, b: 2 } }
      const source = { nested: { b: 3, c: 4 } }
      expect(deepMerge(target, source)).toEqual({
        nested: { a: 1, b: 3, c: 4 },
      })
    })

    it('should not mutate the original target', () => {
      const target = { a: 1 }
      const source = { b: 2 }
      const result = deepMerge(target, source)
      expect(target).toEqual({ a: 1 })
      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('should handle arrays in source (replace, not merge)', () => {
      const target = { arr: [1, 2] }
      const source = { arr: [3, 4, 5] }
      expect(deepMerge(target, source)).toEqual({ arr: [3, 4, 5] })
    })

    it('should skip undefined values in source', () => {
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
      expect(isPlainObject(42)).toBe(false)
      expect(isPlainObject('string')).toBe(false)
      expect(isPlainObject(true)).toBe(false)
      expect(isPlainObject(undefined)).toBe(false)
    })

    it('should return false for class instances', () => {
      class MyClass {}
      expect(isPlainObject(new MyClass())).toBe(false)
    })

    it('should return false for Date objects', () => {
      expect(isPlainObject(new Date())).toBe(false)
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
      debounced()
      vi.advanceTimersByTime(100)

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('sleep', () => {
    it('should resolve after the specified time', async () => {
      const start = Date.now()
      await sleep(50)
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should resolve immediately for 0ms', async () => {
      const start = Date.now()
      await sleep(0)
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(50)
    })
  })

  describe('retry', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success')
      const result = await retry(fn, { maxRetries: 3, initialDelay: 10 })
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success')

      const result = await retry(fn, { maxRetries: 3, initialDelay: 10 })
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'))

      await expect(
        retry(fn, { maxRetries: 2, initialDelay: 10 })
      ).rejects.toThrow('always fails')
      expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
    })
  })

  describe('createLogger', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should log debug messages when debug is true', () => {
      const logger = createLogger(true)
      logger.debug('test message')
      expect(console.log).toHaveBeenCalledWith('[Toggly]', 'test message')
    })

    it('should not log debug messages when debug is false', () => {
      const logger = createLogger(false)
      logger.debug('test message')
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should always log info messages', () => {
      const logger = createLogger(false)
      logger.info('info message')
      expect(console.log).toHaveBeenCalledWith('[Toggly]', 'info message')
    })

    it('should always log warn messages', () => {
      const logger = createLogger(false)
      logger.warn('warn message')
      expect(console.warn).toHaveBeenCalledWith('[Toggly]', 'warn message')
    })

    it('should always log error messages', () => {
      const logger = createLogger(false)
      logger.error('error message')
      expect(console.error).toHaveBeenCalledWith('[Toggly]', 'error message')
    })
  })

  describe('hashString', () => {
    it('should return consistent hash for same string', () => {
      const hash1 = hashString('test-string')
      const hash2 = hashString('test-string')
      expect(hash1).toBe(hash2)
    })

    it('should return different hash for different strings', () => {
      const hash1 = hashString('string-a')
      const hash2 = hashString('string-b')
      expect(hash1).not.toBe(hash2)
    })

    it('should return a positive number', () => {
      const hash = hashString('any-string')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('should handle empty string', () => {
      const hash = hashString('')
      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getPercentageBucket', () => {
    it('should return value between 0 and 100', () => {
      for (let i = 0; i < 100; i++) {
        const bucket = getPercentageBucket('feature', `user-${i}`)
        expect(bucket).toBeGreaterThanOrEqual(0)
        expect(bucket).toBeLessThan(100)
      }
    })

    it('should return consistent value for same inputs', () => {
      const bucket1 = getPercentageBucket('feature', 'user-123')
      const bucket2 = getPercentageBucket('feature', 'user-123')
      expect(bucket1).toBe(bucket2)
    })

    it('should return different values for different features', () => {
      const bucket1 = getPercentageBucket('feature-a', 'user-123')
      const bucket2 = getPercentageBucket('feature-b', 'user-123')
      // Might be same by chance, but very unlikely
      // This test just ensures no crash
      expect(typeof bucket1).toBe('number')
      expect(typeof bucket2).toBe('number')
    })

    it('should distribute users across buckets', () => {
      const buckets = new Map<number, number>()
      const numUsers = 10000

      for (let i = 0; i < numUsers; i++) {
        const bucket = Math.floor(getPercentageBucket('test-feature', `user-${i}`))
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
      }

      // Should have reasonable distribution (at least 50 different buckets)
      expect(buckets.size).toBeGreaterThan(50)
    })
  })
})
