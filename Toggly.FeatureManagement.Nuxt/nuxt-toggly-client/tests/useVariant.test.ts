import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useVariant } from '../src/composables/useVariant'
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

describe('useVariant', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetToggly()
    providedValue = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  it('resolves the assigned variant once the shared client is ready', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: { Checkout: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } } },
      }),
    )

    const toggly = createToggly({ appKey: 'test-key', enableVariants: true })
    provideToggly(toggly)
    await toggly.init()

    const { variant, variantValue, isLoading } = useVariant('Checkout')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isLoading.value).toBe(false)
    expect(variant.value).toEqual({ name: 'treatment', configurationValue: { color: 'blue' } })
    expect(variantValue.value).toEqual({ color: 'blue' })
  })

  it('resolves null for a disabled or unassigned variant', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ defs: { Off: { enabled: false, variant: 'control' } } }),
    )

    const toggly = createToggly({ appKey: 'test-key', enableVariants: true })
    provideToggly(toggly)
    await toggly.init()

    const { variant, variantValue, isLoading } = useVariant('Off')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(isLoading.value).toBe(false)
    expect(variant.value).toBeNull()
    expect(variantValue.value).toBeNull()
  })

  it('stays loading until the client is ready', () => {
    const toggly = createToggly({ appKey: 'test-key', enableVariants: true })
    provideToggly(toggly)
    // Note: init() intentionally not awaited — composable must not resolve early.

    const { variant, isLoading } = useVariant('Checkout')

    expect(isLoading.value).toBe(true)
    expect(variant.value).toBeNull()
  })

  it('re-resolves when the feature key ref changes', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: {
          A: { enabled: true, variant: 'a-variant' },
          B: { enabled: true, variant: 'b-variant' },
        },
      }),
    )

    const toggly = createToggly({ appKey: 'test-key', enableVariants: true })
    provideToggly(toggly)
    await toggly.init()

    const { ref: vueRef } = await import('vue')
    const key = vueRef('A')
    const { variant, refresh } = useVariant(key)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(variant.value?.name).toBe('a-variant')

    key.value = 'B'
    await refresh()

    expect(variant.value?.name).toBe('b-variant')
  })
})
