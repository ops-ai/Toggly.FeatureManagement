import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { useFeatureGate, useFeatureProps } from '../src/composables/useFeatureGate'
import { createToggly, resetToggly, provideToggly } from '../src/composables/useToggly'
import { TOGGLY_INJECTION_KEY } from '../src/types'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
})

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

describe('useFeatureGate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetToggly()
    providedValue = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  it('should evaluate all features with "all" requirement', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: true },
        ],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureGate(['feature-a', 'feature-b'], 'all')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should return false when not all features enabled with "all"', async () => {
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

    const { isEnabled, isDisabled } = useFeatureGate(
      ['feature-a', 'feature-b'],
      'all'
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
    expect(isDisabled.value).toBe(true)
  })

  it('should evaluate with "any" requirement', async () => {
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

    const { isEnabled } = useFeatureGate(['feature-a', 'feature-b'], 'any')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should return false with "any" when no features enabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: false },
          { featureKey: 'feature-b', enabled: false },
        ],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureGate(['feature-a', 'feature-b'], 'any')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
  })

  it('should support negate flag', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureGate(['feature-a'], 'all', true)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
  })

  it('should support negate with disabled feature', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: false }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureGate(['feature-a'], 'all', true)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should handle single string feature key', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureGate('feature-a')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should not evaluate before ready', () => {
    const toggly = createToggly({
      appKey: 'test-key',
      featureDefaults: { 'feature-a': true, 'feature-b': true },
    })
    provideToggly(toggly)

    const { isEnabled, isLoading } = useFeatureGate(
      ['feature-a', 'feature-b'],
      'all'
    )

    expect(isEnabled.value).toBe(false)
    expect(isLoading.value).toBe(true)
  })

  it('should handle errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    toggly.evaluateFeatureGate = vi.fn().mockRejectedValue(new Error('fail'))

    const { isEnabled, isLoading } = useFeatureGate(['feature-a'])

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
    expect(isLoading.value).toBe(false)
  })

  it('should support refresh', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { refresh } = useFeatureGate(['feature-a'])

    await expect(refresh()).resolves.not.toThrow()
  })

  it('should use local evaluation when refresh called before ready', async () => {
    const toggly = createToggly({
      appKey: 'test-key',
      featureDefaults: { 'feature-a': true },
    })
    provideToggly(toggly)

    const { refresh, isEnabled } = useFeatureGate(['feature-a'])

    await refresh()

    expect(isEnabled.value).toBe(true)
  })

  it('should update when features change', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureGate(['feature-a'])

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(isEnabled.value).toBe(true)

    toggly.features.value = { 'feature-a': false }
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
  })

  it('should support reactive feature keys', async () => {
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

    const keys = ref<string[]>(['feature-a'])
    const { isEnabled } = useFeatureGate(keys)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should default requirement to "all"', async () => {
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

    const { isEnabled } = useFeatureGate(['feature-a', 'feature-b'])

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
  })
})

describe('useFeatureProps', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetToggly()
    providedValue = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  it('should handle single featureKey prop', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({ featureKey: 'feature-a' })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should handle multiple featureKeys prop', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: true },
        ],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({
      featureKeys: ['feature-a', 'feature-b'],
      requirement: 'all',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should combine featureKey and featureKeys', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: true },
        ],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({
      featureKey: 'feature-a',
      featureKeys: ['feature-b'],
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should use default requirement and negate values', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({ featureKey: 'feature-a' })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should support negate prop', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({
      featureKey: 'feature-a',
      negate: true,
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(false)
  })

  it('should handle empty props', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({})

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })

  it('should handle featureKey with requirement "any"', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    provideToggly(toggly)
    await toggly.init()

    const { isEnabled } = useFeatureProps({
      featureKey: 'feature-a',
      requirement: 'any',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isEnabled.value).toBe(true)
  })
})
