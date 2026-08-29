import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initServerToggly,
  getServerToggly,
  useServerToggly,
  isServerFeatureOn,
  isServerFeatureOff,
  getServerFeatures,
  resetServerToggly,
  refreshServerToggly,
  createMemoryStorage,
  setServerStorage,
  getServerStorage,
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
    vi.resetAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
    vi.restoreAllMocks()
  })

  describe('initServerToggly', () => {
    it('should initialize the server client', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })

      expect(client).toBeDefined()
      expect(client.state.initialized).toBe(true)
    })

    it('should cache feature definitions', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheTtl: 60000,
        enableLiveUpdates: false,
      })

      const features = getServerFeatures()
      expect(features['feature-a']).toBe(true)
    })

    it('loads cached definitions into feature defaults before fetch', async () => {
      const storage = createMemoryStorage()
      await storage.setItem('toggly:definitions', { 'cached-flag': true })
      setServerStorage(storage)

      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheKeyPrefix: 'toggly:',
        enableLiveUpdates: false,
      })

      // Empty API payload keeps defaults seeded from cache.
      expect(getServerFeatures()['cached-flag']).toBe(true)
    })

    it('should use feature defaults', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({
        appKey: 'test-key',
        featureDefaults: { 'default-feature': true },
        enableLiveUpdates: false,
      })

      const features = getServerFeatures()
      expect(features['default-feature']).toBe(true)
    })

    it('pins the client on globalThis across re-reads', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })
      const first = getServerToggly()
      const fromGlobal = (
        globalThis as typeof globalThis & {
          __togglyServerClient?: ReturnType<typeof getServerToggly>
        }
      ).__togglyServerClient

      expect(first).not.toBeNull()
      expect(fromGlobal).toBe(first)
    })

    it('destroys the previous client when re-initialized', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })
      const first = getServerToggly()
      expect(first).not.toBeNull()
      const destroySpy = vi.spyOn(first!, 'destroy')

      await initServerToggly({ appKey: 'test-key-2', enableLiveUpdates: false })
      const second = getServerToggly()

      expect(destroySpy).toHaveBeenCalledTimes(1)
      expect(second).not.toBeNull()
      expect(second).not.toBe(first)
    })
  })

  describe('getServerToggly', () => {
    it('should return null if not initialized', () => {
      const client = getServerToggly()
      expect(client).toBeNull()
    })

    it('should return client after initialization', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const client = getServerToggly()
      expect(client).not.toBeNull()
    })
  })

  describe('useServerToggly', () => {
    it('should throw if not initialized', () => {
      expect(() => useServerToggly()).toThrow(
        '[Toggly] Server client not initialized'
      )
    })

    it('should return client after initialization', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const client = useServerToggly()
      expect(client).toBeDefined()
    })
  })

  describe('isServerFeatureOn', () => {
    it('should return feature state', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const result = await isServerFeatureOn('feature-a')
      expect(result).toBe(true)
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const result = await isServerFeatureOn('feature-a', 'user-123')
      expect(result).toBe(true)
    })
  })

  describe('isServerFeatureOff', () => {
    it('should return inverted feature state', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const result = await isServerFeatureOff('feature-a')
      expect(result).toBe(false)
    })
  })

  describe('getServerFeatures', () => {
    it('should return empty object if not initialized', () => {
      const features = getServerFeatures()
      expect(features).toEqual({})
    })

    it('should return all features', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const features = getServerFeatures()
      expect(features).toEqual({
        'feature-a': true,
        'feature-b': false,
      })
    })
  })

  describe('resetServerToggly', () => {
    it('should reset the server client', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })
      expect(getServerToggly()).not.toBeNull()

      resetServerToggly()
      expect(getServerToggly()).toBeNull()
    })
  })

  describe('refreshServerToggly', () => {
    it('returns null when not initialized', async () => {
      expect(await refreshServerToggly()).toBeNull()
    })

    it('refreshes and updates cache', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: false }],
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          }),
        )

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        enableLiveUpdates: false,
      })

      const definitions = await refreshServerToggly()
      expect(definitions?.['feature-a']).toBe(true)
      expect(getServerFeatures()['feature-a']).toBe(true)
    })
  })

  describe('server storage helpers', () => {
    it('createMemoryStorage returns a working store', async () => {
      const storage = createMemoryStorage()
      await storage.setItem('k', { ok: true })
      expect(await storage.getItem('k')).toEqual({ ok: true })
    })

    it('setServerStorage replaces the process storage', async () => {
      const custom = createMemoryStorage()
      setServerStorage(custom)
      expect(getServerStorage()).toBe(custom)
    })
  })
})
