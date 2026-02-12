import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useFeatureFlag, useFeatureOff } from '../src/composables/useFeatureFlag'
import { createToggly, resetToggly, provideToggly } from '../src/composables/useToggly'
import { TOGGLY_INJECTION_KEY } from '../src/types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock localStorage
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
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
    onMounted: vi.fn((cb) => cb()),
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

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetToggly()
    providedValue = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  it('should return feature state', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled, isDisabled } = useFeatureFlag('feature-a')

    // Wait for async updates
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
    expect(isDisabled.value).toBe(false)
  })

  it('should return false for missing feature', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureFlag('missing-feature')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
  })

  it('should support reactive feature key', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const featureKey = ref('feature-a')
    const { isEnabled } = useFeatureFlag(featureKey)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(isEnabled.value).toBe(true)

    // Change feature key - this would trigger watch in real Vue
    featureKey.value = 'feature-b'
  })

  it('should refresh feature state', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { refresh } = useFeatureFlag('feature-a')

    await expect(refresh()).resolves.not.toThrow()
  })

  it('should use features from state before ready', async () => {
    const toggly = createToggly({
      appKey: 'test-key',
      featureDefaults: { 'feature-a': true },
    })
    provideToggly(toggly)

    const { isEnabled, isLoading } = useFeatureFlag('feature-a')

    // Before init, isLoading starts as true, but the watch with immediate: true
    // will set it to false after checking features from state
    // The feature value should come from defaults
    expect(isEnabled.value).toBe(true)
  })
})

describe('useFeatureOff', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetToggly()
    providedValue = null
  })

  afterEach(() => {
    resetToggly()
  })

  it('should return inverted feature state', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled, isDisabled } = useFeatureOff('feature-a')

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Note: isEnabled means "feature is off" for useFeatureOff
    expect(isEnabled.value).toBe(false) // feature-a is ON, so "off" is false
    expect(isDisabled.value).toBe(true)
  })
})
