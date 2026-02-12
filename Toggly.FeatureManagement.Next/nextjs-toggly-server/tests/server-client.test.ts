import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initServerToggly,
  getServerToggly,
  useServerToggly,
  isServerFeatureOn,
  isServerFeatureOff,
  getServerFeatures,
  resetServerToggly,
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

      const client = await initServerToggly({ appKey: 'test-key' })

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
      })

      const features = getServerFeatures()
      expect(features['feature-a']).toBe(true)
    })

    it('should use feature defaults', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({
        appKey: 'test-key',
        featureDefaults: { 'default-feature': true },
      })

      const features = getServerFeatures()
      expect(features['default-feature']).toBe(true)
    })
  })

  describe('getServerToggly', () => {
    it('should return null if not initialized', () => {
      const client = getServerToggly()
      expect(client).toBeNull()
    })

    it('should return client after initialization', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key' })

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

      await initServerToggly({ appKey: 'test-key' })

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

      await initServerToggly({ appKey: 'test-key' })

      const result = await isServerFeatureOn('feature-a')
      expect(result).toBe(true)
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key' })

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

      await initServerToggly({ appKey: 'test-key' })

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

      await initServerToggly({ appKey: 'test-key' })

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

      await initServerToggly({ appKey: 'test-key' })
      expect(getServerToggly()).not.toBeNull()

      resetServerToggly()
      expect(getServerToggly()).toBeNull()
    })
  })
})
