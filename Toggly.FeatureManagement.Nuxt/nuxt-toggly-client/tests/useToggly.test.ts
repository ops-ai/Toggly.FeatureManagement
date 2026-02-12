import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import {
  createToggly,
  useToggly,
  provideToggly,
  getTogglyClient,
  resetToggly,
} from '../src/composables/useToggly'
import { TOGGLY_INJECTION_KEY } from '../src/types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock localStorage
const mockLocalStorage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key]
  }),
  clear: vi.fn(() => {
    Object.keys(mockLocalStorage).forEach((key) => delete mockLocalStorage[key])
  }),
})

// Mock Vue inject/provide
let providedValue: unknown = null
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    inject: vi.fn((key) => {
      if (key === TOGGLY_INJECTION_KEY) {
        return providedValue
      }
      return undefined
    }),
    provide: vi.fn((key, value) => {
      if (key === TOGGLY_INJECTION_KEY) {
        providedValue = value
      }
    }),
  }
})

function createMockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  }
}

describe('useToggly', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetToggly()
    providedValue = null
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  describe('createToggly', () => {
    it('should create toggly instance with default config', () => {
      const toggly = createToggly({ appKey: 'test-key' })

      expect(toggly.client).toBeDefined()
      expect(toggly.isReady.value).toBe(false)
      expect(toggly.isLoading.value).toBe(false)
      expect(toggly.features.value).toEqual({})
    })

    it('should load persisted identity from localStorage', () => {
      mockLocalStorage['toggly:identity'] = 'persisted-user'

      const toggly = createToggly({
        appKey: 'test-key',
        persistIdentity: true,
      })

      expect(toggly.identity.value).toBe('persisted-user')
    })

    it('should load persisted features from localStorage', () => {
      mockLocalStorage['toggly:features'] = JSON.stringify({
        'feature-a': true,
        'feature-b': false,
      })

      const toggly = createToggly({
        appKey: 'test-key',
        persistFeatures: true,
      })

      expect(toggly.features.value).toEqual({
        'feature-a': true,
        'feature-b': false,
      })
    })

    it('should use custom storage keys', () => {
      mockLocalStorage['custom:identity'] = 'custom-user'

      const toggly = createToggly({
        appKey: 'test-key',
        persistIdentity: true,
        identityStorageKey: 'custom:identity',
      })

      expect(toggly.identity.value).toBe('custom-user')
    })
  })

  describe('init', () => {
    it('should initialize and fetch features', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const toggly = createToggly({ appKey: 'test-key' })
      await toggly.init()

      expect(toggly.isReady.value).toBe(true)
      expect(toggly.features.value).toEqual({ 'feature-a': true })
    })

    it('should persist features after init', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const toggly = createToggly({
        appKey: 'test-key',
        persistFeatures: true,
      })
      await toggly.init()

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'toggly:features',
        JSON.stringify({ 'feature-a': true })
      )
    })

    it('should handle init errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const toggly = createToggly({
        appKey: 'test-key',
        featureDefaults: { 'default-feature': true },
      })
      await toggly.init()

      expect(toggly.isReady.value).toBe(true)
      expect(toggly.error.value).toBeInstanceOf(Error)
      expect(toggly.features.value).toEqual({ 'default-feature': true })
    })

    it('should update identity ref after init', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const toggly = createToggly({ appKey: 'test-key' })
      await toggly.init()

      expect(toggly.identity.value).toBeDefined()
    })
  })

  describe('refresh', () => {
    it('should refresh features', async () => {
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

      const toggly = createToggly({ appKey: 'test-key' })
      await toggly.init()

      expect(toggly.features.value['feature-a']).toBe(true)

      await toggly.refresh()

      expect(toggly.features.value['feature-a']).toBe(false)
    })

    it('should persist features after refresh', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )

      const toggly = createToggly({
        appKey: 'test-key',
        persistFeatures: true,
      })
      await toggly.init()
      await toggly.refresh()

      expect(localStorage.setItem).toHaveBeenLastCalledWith(
        'toggly:features',
        JSON.stringify({ 'feature-a': true })
      )
    })
  })

  describe('setIdentity', () => {
    it('should set identity and refresh', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      const toggly = createToggly({ appKey: 'test-key' })
      await toggly.init()
      await toggly.setIdentity('new-user')

      expect(toggly.identity.value).toBe('new-user')
    })

    it('should persist identity', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      const toggly = createToggly({
        appKey: 'test-key',
        persistIdentity: true,
      })
      await toggly.init()
      await toggly.setIdentity('new-user')

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'toggly:identity',
        'new-user'
      )
    })
  })

  describe('isFeatureOn / isFeatureOff', () => {
    it('should check feature state', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const toggly = createToggly({ appKey: 'test-key' })
      await toggly.init()

      expect(await toggly.isFeatureOn('feature-a')).toBe(true)
      expect(await toggly.isFeatureOff('feature-a')).toBe(false)
    })
  })

  describe('evaluateFeatureGate', () => {
    it('should evaluate feature gate', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: true },
          ],
        })
      )

      const toggly = createToggly({ appKey: 'test-key' })
      await toggly.init()

      expect(
        await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')
      ).toBe(true)
    })
  })

  describe('useToggly', () => {
    it('should throw if not provided', () => {
      expect(() => useToggly()).toThrow(
        '[Toggly] useToggly() was called but no Toggly instance was found'
      )
    })

    it('should return provided toggly', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const toggly = createToggly({ appKey: 'test-key' })
      provideToggly(toggly)

      const result = useToggly()
      expect(result).toBe(toggly)
    })
  })

  describe('getTogglyClient', () => {
    it('should return null if not initialized', () => {
      expect(getTogglyClient()).toBeNull()
    })

    it('should return client after createToggly', () => {
      createToggly({ appKey: 'test-key' })
      expect(getTogglyClient()).not.toBeNull()
    })
  })

  describe('resetToggly', () => {
    it('should reset global state', () => {
      createToggly({ appKey: 'test-key' })
      expect(getTogglyClient()).not.toBeNull()

      resetToggly()
      expect(getTogglyClient()).toBeNull()
    })
  })
})
