import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MemoryCacheProvider,
  FileCacheProvider,
  DefinitionsCache,
  createMemoryCache,
  createFileCache,
} from '../src/cache'

describe('MemoryCacheProvider', () => {
  let cache: MemoryCacheProvider

  beforeEach(() => {
    cache = new MemoryCacheProvider()
  })

  describe('get/set', () => {
    it('should store and retrieve a value', async () => {
      await cache.set('key', 'value')
      const result = await cache.get('key')
      expect(result).toBe('value')
    })

    it('should return null for non-existent key', async () => {
      const result = await cache.get('non-existent')
      expect(result).toBeNull()
    })

    it('should overwrite existing value', async () => {
      await cache.set('key', 'value1')
      await cache.set('key', 'value2')
      const result = await cache.get('key')
      expect(result).toBe('value2')
    })
  })

  describe('TTL', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire values after TTL', async () => {
      await cache.set('key', 'value', 1000) // 1 second TTL

      // Before expiry
      expect(await cache.get('key')).toBe('value')

      // After expiry
      vi.advanceTimersByTime(1001)
      expect(await cache.get('key')).toBeNull()
    })

    it('should not expire values without TTL', async () => {
      await cache.set('key', 'value') // No TTL

      vi.advanceTimersByTime(100000)
      expect(await cache.get('key')).toBe('value')
    })
  })

  describe('delete', () => {
    it('should delete a value', async () => {
      await cache.set('key', 'value')
      await cache.delete('key')
      expect(await cache.get('key')).toBeNull()
    })

    it('should not throw when deleting non-existent key', async () => {
      await expect(cache.delete('non-existent')).resolves.not.toThrow()
    })
  })

  describe('has', () => {
    it('should return true for existing key', async () => {
      await cache.set('key', 'value')
      expect(await cache.has('key')).toBe(true)
    })

    it('should return false for non-existent key', async () => {
      expect(await cache.has('non-existent')).toBe(false)
    })

    it('should return false for expired key', async () => {
      vi.useFakeTimers()
      await cache.set('key', 'value', 1000)

      vi.advanceTimersByTime(1001)
      expect(await cache.has('key')).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('clear', () => {
    it('should clear all values', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      cache.clear()

      expect(await cache.get('key1')).toBeNull()
      expect(await cache.get('key2')).toBeNull()
    })
  })
})

describe('FileCacheProvider', () => {
  let cache: FileCacheProvider
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `toggly-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    cache = new FileCacheProvider(testDir, false)
  })

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('get/set', () => {
    it('should store and retrieve a value', async () => {
      await cache.set('test-key', 'test-value')
      const result = await cache.get('test-key')
      expect(result).toBe('test-value')
    })

    it('should return null for non-existent key', async () => {
      const result = await cache.get('non-existent')
      expect(result).toBeNull()
    })

    it('should sanitize key to valid filename', async () => {
      await cache.set('key:with:colons', 'value')
      const result = await cache.get('key:with:colons')
      expect(result).toBe('value')
    })
  })

  describe('TTL', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire values after TTL', async () => {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
      await cache.set('key', 'value', 1000)

      // Before expiry
      expect(await cache.get('key')).toBe('value')

      // After expiry
      vi.setSystemTime(new Date('2024-01-01T00:00:02Z'))
      expect(await cache.get('key')).toBeNull()
    })
  })

  describe('delete', () => {
    it('should delete a value', async () => {
      await cache.set('key', 'value')
      await cache.delete('key')
      expect(await cache.get('key')).toBeNull()
    })
  })

  describe('has', () => {
    it('should return true for existing key', async () => {
      await cache.set('key', 'value')
      expect(await cache.has('key')).toBe(true)
    })

    it('should return false for non-existent key', async () => {
      expect(await cache.has('non-existent')).toBe(false)
    })
  })
})

describe('DefinitionsCache', () => {
  let provider: MemoryCacheProvider
  let cache: DefinitionsCache

  beforeEach(() => {
    provider = new MemoryCacheProvider()
    cache = new DefinitionsCache(provider, false)
  })

  describe('getDefinitions/setDefinitions', () => {
    it('should store and retrieve definitions', async () => {
      const definitions = { 'feature-a': true, 'feature-b': false }
      await cache.setDefinitions('defs', definitions)

      const result = await cache.getDefinitions('defs')
      expect(result).toEqual(definitions)
    })

    it('should return null for non-existent definitions', async () => {
      const result = await cache.getDefinitions('non-existent')
      expect(result).toBeNull()
    })

    it('should handle invalid JSON gracefully', async () => {
      // Manually set invalid JSON
      await provider.set('invalid', 'not-json')

      const providerCache = new DefinitionsCache(provider, false)
      const result = await providerCache.getDefinitions('invalid')
      expect(result).toBeNull()
    })
  })

  describe('getEtag/setEtag', () => {
    it('should store and retrieve ETag', async () => {
      await cache.setEtag('etag-key', '"abc123"')

      const result = await cache.getEtag('etag-key')
      expect(result).toBe('"abc123"')
    })

    it('should return null for non-existent ETag', async () => {
      const result = await cache.getEtag('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('clear', () => {
    it('should clear cached data', async () => {
      await cache.setDefinitions('defs', { feature: true })
      await cache.clear('defs')

      const result = await cache.getDefinitions('defs')
      expect(result).toBeNull()
    })
  })
})

describe('factory functions', () => {
  it('createMemoryCache should return MemoryCacheProvider', () => {
    const cache = createMemoryCache()
    expect(cache).toBeInstanceOf(MemoryCacheProvider)
  })

  it('createFileCache should return FileCacheProvider', () => {
    const cache = createFileCache('/tmp/test-cache', false)
    expect(cache).toBeInstanceOf(FileCacheProvider)
  })
})
