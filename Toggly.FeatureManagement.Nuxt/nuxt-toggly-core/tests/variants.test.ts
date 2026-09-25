import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../src/client'

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
    headers: {
      get: () => null,
    },
  }
}

describe('enableVariants', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete (globalThis as { WebSocket?: unknown }).WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches from evaluated-variants-signed and derives booleans + variants', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: {
          Checkout: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
          Off: { enabled: false, variant: 'control' },
        },
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      enableVariants: true,
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    const result = await client.init()

    const url = String(mockFetch.mock.calls[0]?.[0])
    expect(url).toContain('/evaluated-variants-signed/test-key/')
    expect(url).not.toContain('/evaluated-signed/')
    expect(url).not.toContain('/definitions-signed/')

    expect(result).toEqual({ Checkout: true, Off: false })
    expect(client.state.features).toEqual({ Checkout: true, Off: false })
    expect(client.state.variants).toEqual({
      Checkout: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
      Off: { enabled: false, variant: 'control' },
    })

    expect(client.getVariant('Checkout')).toEqual({ name: 'treatment', configurationValue: { color: 'blue' } })
    expect(client.getVariant('Off')).toBeNull()
    expect(client.getVariantValue('Checkout')).toEqual({ color: 'blue' })
    expect(client.getVariantValue('Off')).toBeNull()
    const isColor = (v: unknown): v is { color: string } =>
      typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string'
    expect(client.getVariantValue('Checkout', isColor)).toEqual({ color: 'blue' })
    expect(client.getVariantValue('Checkout', (v): v is number => typeof v === 'number')).toBeNull()

    client.destroy()
  })

  it('returns null for unknown feature keys and when enableVariants is false', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ features: [{ featureKey: 'Plain', enabled: true }] }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    // enableVariants is not set — variant APIs always return null even if the
    // feature is enabled via the boolean rail.
    expect(client.getVariant('Plain')).toBeNull()
    expect(client.getVariantValue('Plain')).toBeNull()

    client.destroy()
  })

  it('returns null for enabled variant entries with no variant name assigned', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ defs: { Flag: { enabled: true } } }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      enableVariants: true,
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    expect(client.state.features).toEqual({ Flag: true })
    expect(client.getVariant('Flag')).toBeNull()

    client.destroy()
  })

  it('coerces malformed variant payloads (arrays/primitives) to an empty defs map', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse([1, 2, 3]))

    const client = createTogglyClient({
      appKey: 'test-key',
      enableVariants: true,
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    expect(client.state.variants).toEqual({})
    expect(client.state.features).toEqual({})
    expect(client.getVariant('Anything')).toBeNull()

    client.destroy()
  })

  it('applies local gates as a read-time AND on the assigned variant enabled flag', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: { Checkout: { enabled: true, variant: 'treatment' } },
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      enableVariants: true,
      refreshInterval: 0,
      enableLiveUpdates: false,
      localGates: [
        {
          id: 'deviceGate',
          flagKeys: ['Checkout'],
          isEnabled: () => false,
        },
      ],
    })
    await client.init()

    // Boolean rail is gated too...
    await expect(client.isFeatureOn('Checkout')).resolves.toBe(false)
    // ...and so is the variant rail — a gated-off flag has no variant.
    expect(client.getVariant('Checkout')).toBeNull()

    client.destroy()
  })

  it('refetches variant assignment when identity changes (remote rail)', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ defs: { Checkout: { enabled: true, variant: 'control' } } }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      identity: 'user-1',
      enableVariants: true,
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()
    expect(client.getVariant('Checkout')).toEqual({ name: 'control', configurationValue: undefined })

    mockFetch.mockResolvedValueOnce(
      createMockResponse({ defs: { Checkout: { enabled: true, variant: 'treatment' } } }),
    )
    await client.setIdentity('user-2')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const secondUrl = String(mockFetch.mock.calls[1]?.[0])
    expect(secondUrl).toContain('/evaluated-variants-signed/test-key/')
    expect(client.getVariant('Checkout')).toEqual({ name: 'treatment', configurationValue: undefined })

    client.destroy()
  })

  it('clears variant state when a boolean-only evaluated snapshot is hydrated', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ defs: { Checkout: { enabled: true, variant: 'treatment' } } }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      enableVariants: true,
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()
    expect(client.getVariant('Checkout')).not.toBeNull()

    client.hydrateEvaluatedFeatures({ Checkout: true })

    expect(client.state.variants).toBeNull()
    expect(client.getVariant('Checkout')).toBeNull()

    client.destroy()
  })
})
