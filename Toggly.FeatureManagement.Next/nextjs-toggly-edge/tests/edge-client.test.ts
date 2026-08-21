import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TogglyEdgeClient,
  createEdgeClient,
  initEdgeToggly,
  getEdgeToggly,
  resetEdgeToggly,
} from '../src/edge-client'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(data: unknown, status = 200) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
  }
}

describe('TogglyEdgeClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetEdgeToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetEdgeToggly()
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should create a client with default config', () => {
      const client = new TogglyEdgeClient({ appKey: 'test-key' })

      expect(client.identity).toBeDefined()
    })

    it('should initialize with feature defaults', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })

      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
    })

    it('should fetch features from API', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('reads unsigned defs and collapses entity gates', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          defs: {
            'feature-a': true,
            EntityGated: {
              requirement: 'all',
              rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
            },
          },
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
      expect(client.isFeatureOnSync('EntityGated')).toBe(false)
    })

    it('reads a raw unsigned definition map', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ 'feature-a': true }))

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
    })

    it('reads text() and falls back when verifySignatures gets invalid envelope', async () => {
      const invalidBody = JSON.stringify({ defs: { 'feature-a': true } })
      const text = vi.fn().mockResolvedValue(invalidBody)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text,
        json: async () => JSON.parse(invalidBody),
      })

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        verifySignatures: true,
        featureDefaults: { 'feature-a': false },
      })
      await client.init()

      expect(text).toHaveBeenCalled()
      expect(client.isFeatureOnSync('feature-a')).toBe(false)
    })
  })

  describe('feature evaluation', () => {
    it('should evaluate single feature', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.isFeatureOn('feature-a')

      expect(result).toBe(true)
    })

    it('should evaluate feature off', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.isFeatureOff('feature-a')

      expect(result).toBe(true)
    })

    it('should evaluate feature gate with all requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: true },
          ],
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'all'
      )

      expect(result).toBe(true)
    })

    it('should evaluate feature gate with any requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'any'
      )

      expect(result).toBe(true)
    })

    it('should evaluate feature gate with negate', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.evaluateFeatureGate(
        ['feature-a'],
        'all',
        true
      )

      expect(result).toBe(false)
    })
  })

  describe('caching', () => {
    it('should use cached features within TTL', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        cache: true,
        cacheTtl: 60,
      })

      await client.init()
      await client.fetchDefinitions() // Should use cache

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should refresh when cache expires', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: false }],
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })

      await client.init()
      expect(client.isFeatureOnSync('feature-a')).toBe(false)

      await client.refresh() // Force refresh
      expect(client.isFeatureOnSync('feature-a')).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should fall back to defaults on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })

      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
      expect(client.getState().error).toBeInstanceOf(Error)
    })
  })
})

describe('createEdgeClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should create an edge client', () => {
    const client = createEdgeClient({ appKey: 'test-key' })
    expect(client).toBeInstanceOf(TogglyEdgeClient)
  })
})

describe('Global edge client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetEdgeToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetEdgeToggly()
  })

  it('should initialize global client', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    const client = await initEdgeToggly({ appKey: 'test-key' })

    expect(client).toBeInstanceOf(TogglyEdgeClient)
    expect(getEdgeToggly()).toBe(client)
  })

  it('should return null before initialization', () => {
    expect(getEdgeToggly()).toBeNull()
  })

  it('should reset global client', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    await initEdgeToggly({ appKey: 'test-key' })
    expect(getEdgeToggly()).not.toBeNull()

    resetEdgeToggly()
    expect(getEdgeToggly()).toBeNull()
  })
})
