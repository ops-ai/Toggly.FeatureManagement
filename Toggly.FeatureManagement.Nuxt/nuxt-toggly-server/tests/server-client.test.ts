import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'
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

function featureDefs(flags: Record<string, boolean>): FeatureDefinitionModel[] {
  return Object.entries(flags).map(([featureKey, enabled]) => ({
    featureKey,
    filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }],
  }))
}

function createMockResponse(data: unknown, status = 200) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
    headers: { get: () => null },
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
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      const client = await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      expect(client).toBeDefined()
      expect(client.state.initialized).toBe(true)
      expect(client.config.evaluationMode).toBe('local')
      expect(client.state.features).toEqual({ 'feature-a': true })
    })

    it('should fetch definitions-signed without identity query params', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(featureDefs({})))

      await initServerToggly({
        appKey: 'test-key',
        environment: 'Staging',
        identity: 'user-123',
        enableLiveUpdates: false,
      })

      const url = String(mockFetch.mock.calls[0]?.[0])
      expect(url).toContain('/definitions-signed/test-key/Staging')
      expect(url).not.toContain('/evaluated-signed/')
      expect(new URL(url).searchParams.get('u')).toBeNull()
    })

    it('should disable auto-refresh by default on server', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      const client = await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      expect(client.config.refreshInterval).toBe(0)
    })

    it('should enable live updates by default', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      const client = await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
        webSocketImpl: undefined,
      })
      // Explicit false still respected; default when omitted is true
      expect(client.config.enableLiveUpdates).toBe(false)

      client.destroy()
      resetServerToggly()

      mockFetch.mockResolvedValueOnce(createMockResponse([]))
      const live = await initServerToggly({
        appKey: 'test-key',
        // Force no socket so unit tests stay isolated
        webSocketImpl: class {
          close() {}
          on() {}
        } as unknown as new (url: string) => unknown,
      })
      expect(live.config.enableLiveUpdates).toBe(true)
      live.destroy()
    })

    it('should cache definitions when cache is enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

      const storage = getServerStorage()
      const cached = await storage.getItem('toggly:server:definitions')

      expect(cached).toEqual({ 'feature-a': true })
    })

    it('should use cached definitions on subsequent init', async () => {
      // First init
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })
      resetServerToggly()

      // Second init should use cache as defaults
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-b': true }))
      )

      // Re-create storage to keep cache
      const storage = createMemoryStorage()
      await storage.setItem('toggly:server:definitions', { 'feature-a': true })
      setServerStorage(storage)

      const client = await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

      // Should have both cached and new features
      expect(client.state.features).toEqual({
        'feature-a': true,
        'feature-b': true,
      })
    })

    it('should use custom cache key prefix', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key',
        cache: true,
        cacheKeyPrefix: 'custom:prefix:', enableLiveUpdates: false })

      const storage = getServerStorage()
      const cached = await storage.getItem('custom:prefix:definitions')

      expect(cached).toEqual({ 'feature-a': true })
    })

    it('should allow custom refresh interval', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      const client = await initServerToggly({ appKey: 'test-key',
        refreshInterval: 5000, enableLiveUpdates: false })

      expect(client.config.refreshInterval).toBe(5000)

      client.destroy()
    })
  })

  describe('getServerToggly', () => {
    it('should return null if not initialized', () => {
      expect(getServerToggly()).toBeNull()
    })

    it('should return client if initialized', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

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
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      expect(useServerToggly()).not.toBeNull()
    })
  })

  describe('refreshServerToggly', () => {
    it('should refresh and update cache', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse(featureDefs({ 'feature-a': true }))
        )
        .mockResolvedValueOnce(
          createMockResponse(featureDefs({ 'feature-a': false }))
        )

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

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
        createMockResponse(
          featureDefs({ 'feature-a': true, 'feature-b': false }),
        )
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      expect(await isServerFeatureOn('feature-a')).toBe(true)
      expect(await isServerFeatureOn('feature-b')).toBe(false)
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', identity: 'default-user', enableLiveUpdates: false })

      const client = getServerToggly()!

      await isServerFeatureOn('feature-a', 'custom-user')

      // Identity should be restored after call
      expect(client.identity).toBe('default-user')
    })
  })

  describe('isServerFeatureOff', () => {
    it('should return inverse of isServerFeatureOn', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      expect(await isServerFeatureOff('feature-a')).toBe(false)
    })
  })

  describe('resetServerToggly', () => {
    it('should reset client and clear storage', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

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

      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

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
