import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { vFeature, vFeatureShow, vFeatureClass } from '../src/directives/vFeature'
import { createToggly, resetToggly } from '../src/composables/useToggly'

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

function createMockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  }
}

function createMockElement(): HTMLElement {
  return {
    style: { display: '', visibility: '' },
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  } as unknown as HTMLElement
}

function createMockBinding(
  value: unknown,
  modifiers: Record<string, boolean> = {},
  arg?: string
) {
  return {
    value,
    modifiers,
    arg,
    oldValue: undefined,
    instance: null,
    dir: vFeature,
  }
}

describe('vFeature directive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  it('should hide element when feature is disabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: false }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('none')
  })

  it('should show element when feature is enabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('')
  })

  it('should support array of feature keys', async () => {
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

    const el = createMockElement()
    const binding = createMockBinding(['feature-a', 'feature-b'])

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('')
  })

  it('should support "any" modifier', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding(['feature-a', 'feature-b'], { any: true })

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('')
  })

  it('should support "not" modifier', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a', { not: true })

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('none')
  })

  it('should support object syntax', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding({
      key: 'feature-a',
      requirement: 'all',
      negate: false,
    })

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('')
  })

  it('should show element if no keys specified', async () => {
    const toggly = createToggly({ appKey: 'test-key' })

    const el = createMockElement()
    const binding = createMockBinding({ key: undefined })

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('')
  })

  it('should warn and hide if client not initialized', () => {
    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeature.mounted!(el, binding as any, null as any, null as any)

    expect(console.warn).toHaveBeenCalled()
    expect(el.style.display).toBe('none')
  })

  it('should update on directive update', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeature.updated!(el, binding as any, null as any, null as any)

    expect(el.style.display).toBe('')
  })
})

describe('vFeatureShow directive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetToggly()
  })

  afterEach(() => {
    resetToggly()
  })

  it('should use visibility instead of display', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: false }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeatureShow.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.visibility).toBe('hidden')
  })

  it('should set visibility to visible when enabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeatureShow.mounted!(el, binding as any, null as any, null as any)

    expect(el.style.visibility).toBe('visible')
  })
})

describe('vFeatureClass directive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetToggly()
  })

  it('should add class when feature is enabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a', {}, 'enabled')

    vFeatureClass.mounted!(el, binding as any, null as any, null as any)

    expect(el.classList.add).toHaveBeenCalledWith('enabled')
  })

  it('should remove class when feature is disabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: false }],
      })
    )

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a', {}, 'enabled')

    vFeatureClass.mounted!(el, binding as any, null as any, null as any)

    expect(el.classList.remove).toHaveBeenCalledWith('enabled')
  })

  it('should warn if no class name argument', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    const toggly = createToggly({ appKey: 'test-key' })
    await toggly.init()

    const el = createMockElement()
    const binding = createMockBinding('feature-a')

    vFeatureClass.mounted!(el, binding as any, null as any, null as any)

    expect(console.warn).toHaveBeenCalledWith(
      '[Toggly] v-feature-class requires an argument (class name)'
    )
  })
})
