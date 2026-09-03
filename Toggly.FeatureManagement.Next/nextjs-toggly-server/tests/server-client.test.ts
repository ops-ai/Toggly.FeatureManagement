import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel } from '@ops-ai/nextjs-toggly-core'
import {
  initServerToggly,
  getServerToggly,
  waitForServerToggly,
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

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'feature-a',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

const alwaysOff: FeatureDefinitionModel = {
  featureKey: 'feature-b',
  filters: [{ name: 'AlwaysOff', parameters: {} }],
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

function defsResponse(definitions: FeatureDefinitionModel[], status = 200) {
  const body = JSON.stringify(definitions)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
    json: async () => definitions,
    headers: { get: () => null },
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
    it('should initialize the server client on the local rail', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

      const client = await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })

      expect(client).toBeDefined()
      expect(client.state.initialized).toBe(true)
      expect(client.config.evaluationMode).toBe('local')

      const url = String(mockFetch.mock.calls[0]?.[0])
      expect(url).toContain('/definitions-signed/')
      expect(url).not.toContain('/evaluated-signed/')
    })

    it('forces evaluationMode local even when caller requests remote', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

      const client = await initServerToggly({
        appKey: 'test-key',
        evaluationMode: 'remote',
        enableLiveUpdates: false,
      })

      expect(client.config.evaluationMode).toBe('local')
      const url = String(mockFetch.mock.calls[0]?.[0])
      expect(url).toContain('/definitions-signed/')
    })

    it('should cache raw definition models', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheTtl: 60000,
        enableLiveUpdates: false,
      })

      const features = getServerFeatures()
      expect(features['feature-a']).toBe(true)

      const cached = await getServerStorage().getItem<FeatureDefinitionModel[]>(
        'toggly:server:definitions'
      )
      expect(cached?.[0]?.featureKey).toBe('feature-a')
      expect(cached?.[0]?.filters?.[0]?.name).toBe('AlwaysOn')
    })

    it('hydrates cached definition models when fetch fails', async () => {
      const storage = createMemoryStorage()
      await storage.setItem('toggly:definitions', [alwaysOn])
      setServerStorage(storage)

      mockFetch.mockRejectedValueOnce(new Error('network down'))

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheKeyPrefix: 'toggly:',
        enableLiveUpdates: false,
      })

      expect(getServerFeatures()['feature-a']).toBe(true)
      expect(useServerToggly().getDefinitions().has('feature-a')).toBe(true)
    })

    it('ignores legacy boolean cache entries', async () => {
      const storage = createMemoryStorage()
      await storage.setItem('toggly:definitions', { 'cached-flag': true })
      setServerStorage(storage)

      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        cacheKeyPrefix: 'toggly:',
        enableLiveUpdates: false,
      })

      expect(getServerFeatures()['cached-flag']).toBeUndefined()
    })

    it('should use feature defaults', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await initServerToggly({
        appKey: 'test-key',
        featureDefaults: { 'default-feature': true },
        enableLiveUpdates: false,
      })

      const features = getServerFeatures()
      expect(features['default-feature']).toBe(true)
    })

    it('pins the client on globalThis across re-reads', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

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
        .mockResolvedValueOnce(defsResponse([]))
        .mockResolvedValueOnce(defsResponse([]))

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

    it('coalesces concurrent init calls onto one client', async () => {
      mockFetch.mockResolvedValue(defsResponse([alwaysOn]))

      const first = initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })
      const second = initServerToggly({
        appKey: 'other-key',
        enableLiveUpdates: false,
      })
      const waiting = waitForServerToggly()

      const [a, b, waited] = await Promise.all([first, second, waiting])

      expect(a).toBe(b)
      expect(waited).toBe(a)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(getServerToggly()).toBe(a)
    })
  })

  describe('waitForServerToggly', () => {
    it('returns null when nothing is initializing', async () => {
      await expect(waitForServerToggly()).resolves.toBeNull()
    })
  })

  describe('getServerToggly', () => {
    it('should return null if not initialized', () => {
      const client = getServerToggly()
      expect(client).toBeNull()
    })

    it('should return client after initialization', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

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
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const client = useServerToggly()
      expect(client).toBeDefined()
    })
  })

  describe('isServerFeatureOn', () => {
    it('should return feature state', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const result = await isServerFeatureOn('feature-a')
      expect(result).toBe(true)
    })

    it('evaluates identity overrides on the shared client', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([targetingAlice]))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      const shared = useServerToggly()
      expect(await isServerFeatureOn('targeted-flag')).toBe(false)
      expect(await isServerFeatureOn('targeted-flag', 'alice')).toBe(true)
      expect(await isServerFeatureOn('targeted-flag', 'bob')).toBe(false)
      // Shared client identity must not be mutated by overrides
      expect(shared.identity).toBe('bob')
      expect(getServerToggly()).toBe(shared)
    })
  })

  describe('isServerFeatureOff', () => {
    it('should return inverted feature state', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

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

    it('should return evaluated boolean snapshot', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn, alwaysOff]))

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
      mockFetch.mockResolvedValueOnce(defsResponse([]))

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

    it('refreshes and updates definition cache', async () => {
      mockFetch
        .mockResolvedValueOnce(defsResponse([alwaysOff]))
        .mockResolvedValueOnce(defsResponse([alwaysOn]))

      await initServerToggly({
        appKey: 'test-key',
        cache: true,
        enableLiveUpdates: false,
      })

      expect(getServerFeatures()['feature-a']).toBeUndefined()
      expect(getServerFeatures()['feature-b']).toBe(false)

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
