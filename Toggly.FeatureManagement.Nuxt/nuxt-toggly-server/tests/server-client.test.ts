import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initServerToggly,
  getServerToggly,
  useServerToggly,
  refreshServerToggly,
  isServerFeatureOn,
  isServerFeatureOff,
  resetServerToggly,
  setServerStorage,
  getServerStorage,
  createMemoryStorage,
} from '../src/server-client'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  }
}

describe('Server Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
  })

  describe('initServerToggly', () => {
    it('should initialize the server client', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = await initServerToggly({ appKey: 'test-key' })

      expect(client).toBeDefined()
      expect(client.state.initialized).toBe(true)
      expect(client.state.features).toEqual({ 'feature-a': true })
    })

    it('should disable auto-refresh by default on server', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = await initServerToggly({ appKey: 'test-key' })

      expect(client.config.refreshInterval).toBe(0)
    })

    it('should cache definitions when cache is enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', cache: true })

      const storage = getServerStorage()
      const cached = await storage.getItem('toggly:server:definitions')

      expect(cached).toEqual({ 'feature-a': true })
    })

    it('should use cached definitions on subsequent init', async () => {
      // First init
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', cache: true })
      resetServerToggly()

      // Second init should use cache as defaults
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-b', enabled: true }],
        })
      )

      // Re-create storage to keep cache
      const storage = createMemoryStorage()
      await storage.setItem('toggly:server:definitions', { 'feature-a': true })
      setServerStorage(storage)

      const client = await initServerToggly({ appKey: 'test-key', cache: true })

      // Should have both cached and new features
      expect(client.state.features).toEqual({
        'feature-a': true,
        'feature-b': true,
      })
    })

    it('should use custom cache key prefix', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheKeyPrefix: 'custom:prefix:',
      })

      const storage = getServerStorage()
      const cached = await storage.getItem('custom:prefix:definitions')

      expect(cached).toEqual({ 'feature-a': true })
    })

    it('should allow custom refresh interval', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = await initServerToggly({
        appKey: 'test-key',
        refreshInterval: 5000,
      })

      expect(client.config.refreshInterval).toBe(5000)

      client.destroy()
    })
  })

  describe('getServerToggly', () => {
    it('should return null if not initialized', () => {
      expect(getServerToggly()).toBeNull()
    })

    it('should return client if initialized', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key' })

      expect(getServerToggly()).not.toBeNull()
    })
  })

  describe('useServerToggly', () => {
    it('should throw if not initialized', () => {
      expect(() => useServerToggly()).toThrow(
        '[Toggly] Server client not initialized'
      )
    })

    it('should return client if initialized', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key' })

      expect(useServerToggly()).not.toBeNull()
    })
  })

  describe('refreshServerToggly', () => {
    it('should refresh and update cache', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: false }],
          })
        )

      await initServerToggly({ appKey: 'test-key', cache: true })

      const storage = getServerStorage()
      let cached = await storage.getItem<Record<string, boolean>>(
        'toggly:server:definitions'
      )
      expect(cached?.['feature-a']).toBe(true)

      await refreshServerToggly()

      cached = await storage.getItem<Record<string, boolean>>(
        'toggly:server:definitions'
      )
      expect(cached?.['feature-a']).toBe(false)
    })

    it('should do nothing if not initialized', async () => {
      await expect(refreshServerToggly()).resolves.not.toThrow()
    })
  })

  describe('isServerFeatureOn', () => {
    it('should return feature state', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      await initServerToggly({ appKey: 'test-key' })

      expect(await isServerFeatureOn('feature-a')).toBe(true)
      expect(await isServerFeatureOn('feature-b')).toBe(false)
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', identity: 'default-user' })

      const client = getServerToggly()!

      await isServerFeatureOn('feature-a', 'custom-user')

      // Identity should be restored after call
      expect(client.identity).toBe('default-user')
    })
  })

  describe('isServerFeatureOff', () => {
    it('should return inverse of isServerFeatureOn', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key' })

      expect(await isServerFeatureOff('feature-a')).toBe(false)
    })
  })

  describe('resetServerToggly', () => {
    it('should reset client and clear storage', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', cache: true })

      expect(getServerToggly()).not.toBeNull()

      resetServerToggly()

      expect(getServerToggly()).toBeNull()
    })
  })

  describe('setServerStorage / getServerStorage', () => {
    it('should allow custom storage implementation', async () => {
      const customStorage = {
        getItem: vi.fn().mockResolvedValue(null),
        setItem: vi.fn().mockResolvedValue(undefined),
        removeItem: vi.fn().mockResolvedValue(undefined),
        hasItem: vi.fn().mockResolvedValue(false),
      }

      setServerStorage(customStorage)

      expect(getServerStorage()).toBe(customStorage)

      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', cache: true })

      expect(customStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('createMemoryStorage', () => {
    it('should create a new memory storage instance', () => {
      const storage = createMemoryStorage()

      expect(storage).toBeDefined()
      expect(storage.getItem).toBeDefined()
      expect(storage.setItem).toBeDefined()
      expect(storage.removeItem).toBeDefined()
      expect(storage.hasItem).toBeDefined()
    })

    it('should handle TTL correctly', async () => {
      vi.useFakeTimers()

      const storage = createMemoryStorage()

      await storage.setItem('key', 'value', { ttl: 100 })

      expect(await storage.getItem('key')).toBe('value')

      vi.advanceTimersByTime(101)

      expect(await storage.getItem('key')).toBeNull()

      vi.useRealTimers()
    })

    it('should handle items without TTL', async () => {
      const storage = createMemoryStorage()

      await storage.setItem('key', 'value')

      expect(await storage.getItem('key')).toBe('value')
      expect(await storage.hasItem('key')).toBe(true)
    })

    it('should remove items', async () => {
      const storage = createMemoryStorage()

      await storage.setItem('key', 'value')
      await storage.removeItem('key')

      expect(await storage.getItem('key')).toBeNull()
    })
  })
})
