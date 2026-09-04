import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel } from '@ops-ai/nuxt-toggly-core'
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

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'feature-a',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

const targetingAlice: FeatureDefinitionModel = {
  featureKey: 'targeted-flag',
  filters: [
    {
      name: 'Targeting',
      parameters: {
        'Audience.Users:0': 'alice',
        'Audience.DefaultRolloutPercentage': 0,
      },
    },
  ],
}

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
      expect(client.config.enableLiveUpdates).toBe(false)

      client.destroy()
      resetServerToggly()

      mockFetch.mockResolvedValueOnce(createMockResponse([]))
      const live = await initServerToggly({
        appKey: 'test-key',
        webSocketImpl: class {
          close() {}
          on() {}
        } as unknown as new (url: string) => unknown,
      })
      expect(live.config.enableLiveUpdates).toBe(true)
      live.destroy()
    })

    it('should cache raw definition models', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([alwaysOn]))

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

      const storage = getServerStorage()
      const cached = await storage.getItem<FeatureDefinitionModel[]>(
        'toggly:server:definitions'
      )

      expect(cached?.[0]?.featureKey).toBe('feature-a')
      expect(cached?.[0]?.filters?.[0]?.name).toBe('AlwaysOn')
    })

    it('hydrates cached definition models when fetch fails', async () => {
      const storage = createMemoryStorage()
      await storage.setItem('toggly:server:definitions', [alwaysOn])
      setServerStorage(storage)

      mockFetch.mockRejectedValueOnce(new Error('network down'))

      const client = await initServerToggly({
        appKey: 'test-key',
        cache: true,
        enableLiveUpdates: false,
      })

      expect(client.state.features['feature-a']).toBe(true)
      expect(client.getDefinitions().has('feature-a')).toBe(true)
    })

    it('ignores legacy boolean cache entries', async () => {
      const storage = createMemoryStorage()
      await storage.setItem('toggly:server:definitions', { 'cached-flag': true })
      setServerStorage(storage)

      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      const client = await initServerToggly({
        appKey: 'test-key',
        cache: true,
        enableLiveUpdates: false,
      })

      expect(client.state.features['cached-flag']).toBeUndefined()
    })

    it('should use custom cache key prefix', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([alwaysOn]))

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheKeyPrefix: 'custom:prefix:',
        enableLiveUpdates: false,
      })

      const storage = getServerStorage()
      const cached = await storage.getItem<FeatureDefinitionModel[]>(
        'custom:prefix:definitions'
      )

      expect(cached?.[0]?.featureKey).toBe('feature-a')
    })

    it('should allow custom refresh interval', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      const client = await initServerToggly({
        appKey: 'test-key',
        refreshInterval: 5000,
        enableLiveUpdates: false,
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
    it('should refresh and update definition cache', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse([alwaysOn]))
        .mockResolvedValueOnce(
          createMockResponse([
            {
              featureKey: 'feature-a',
              filters: [{ name: 'AlwaysOff', parameters: {} }],
            },
          ])
        )

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

      const storage = getServerStorage()
      let cached = await storage.getItem<FeatureDefinitionModel[]>(
        'toggly:server:definitions'
      )
      expect(cached?.[0]?.filters?.[0]?.name).toBe('AlwaysOn')

      const snapshot = await refreshServerToggly()
      expect(snapshot?.['feature-a']).toBe(false)

      cached = await storage.getItem<FeatureDefinitionModel[]>(
        'toggly:server:definitions'
      )
      expect(cached?.[0]?.filters?.[0]?.name).toBe('AlwaysOff')
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

    it('evaluates identity overrides on the shared client', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([targetingAlice]))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      const shared = useServerToggly()
      expect(await isServerFeatureOn('targeted-flag')).toBe(false)
      expect(await isServerFeatureOn('targeted-flag', 'alice')).toBe(true)
      expect(await isServerFeatureOn('targeted-flag', 'bob')).toBe(false)
      expect(shared.identity).toBe('bob')
      expect(getServerToggly()).toBe(shared)
    })

    it('does not race shared identity under concurrent overrides', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([targetingAlice]))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      const results = await Promise.all([
        isServerFeatureOn('targeted-flag', 'alice'),
        isServerFeatureOn('targeted-flag', 'bob'),
        isServerFeatureOn('targeted-flag', 'alice'),
      ])

      expect(results).toEqual([true, false, true])
      expect(useServerToggly().identity).toBe('bob')
    })

    it('evaluates Country from headers via fromHttpRequest', async () => {
      const countryFlag: FeatureDefinitionModel = {
        featureKey: 'country-flag',
        filters: [
          {
            name: 'Country',
            parameters: { Percentage: 100, 'Country:0': 'US' },
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse([countryFlag]))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'user-1',
        enableLiveUpdates: false,
      })

      expect(await isServerFeatureOn('country-flag')).toBe(false)
      expect(
        await isServerFeatureOn('country-flag', {
          headers: { 'cf-ipcountry': 'US' },
        }),
      ).toBe(true)
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

      mockFetch.mockResolvedValueOnce(createMockResponse([alwaysOn]))

      await initServerToggly({ appKey: 'test-key', cache: true, enableLiveUpdates: false })

      expect(customStorage.setItem).toHaveBeenCalled()
      expect(customStorage.getItem).toHaveBeenCalled()
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
