import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../src/client'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(data: unknown, status = 200, headers: Record<string, string | null> = {}) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  }
}

describe('enableVariants / getVariant / getVariantValue', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getVariant/getVariantValue return null when enableVariants is not set', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({ defs: { 'new-checkout': true } }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    expect(client.getVariant('new-checkout')).toBeNull()
    expect(client.getVariantValue('new-checkout')).toBeNull()

    client.destroy()
  })

  it('fetches /evaluated-variants-signed and exposes the assigned variant', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: {
          'new-checkout': {
            enabled: true,
            variant: 'treatment',
            configurationValue: { color: 'blue' },
          },
          'old-flag': { enabled: false },
        },
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await client.init()

    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/evaluated-variants-signed/test-key/Production',
    )

    expect(client.getVariant('new-checkout')).toEqual({
      name: 'treatment',
      configurationValue: { color: 'blue' },
    })
    expect(client.getVariantValue('new-checkout')).toEqual({ color: 'blue' })

    // Boolean snapshot still reflects `enabled` for existing isFeatureOn / features consumers.
    expect(await client.isFeatureOn('new-checkout')).toBe(true)
    expect(await client.isFeatureOn('old-flag')).toBe(false)

    client.destroy()
  })

  it('returns null when the feature is disabled even if a variant name is present', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: {
          'disabled-flag': { enabled: false, variant: 'treatment', configurationValue: 42 },
        },
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await client.init()

    expect(client.getVariant('disabled-flag')).toBeNull()
    expect(client.getVariantValue('disabled-flag')).toBeNull()

    client.destroy()
  })

  it('returns null when enabled but no variant name is assigned', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: { 'no-variant': { enabled: true } },
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await client.init()

    expect(client.getVariant('no-variant')).toBeNull()

    client.destroy()
  })

  it('returns null for an unknown feature key', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ defs: {} }))

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await client.init()

    expect(client.getVariant('unknown')).toBeNull()
    expect(client.getVariantValue('unknown')).toBeNull()

    client.destroy()
  })

  it('applies local gates on top of the remote variant enabled bit', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        defs: {
          'gated-flag': { enabled: true, variant: 'treatment', configurationValue: 'x' },
        },
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
      localGates: [{ id: 'gate-1', flagKeys: ['gated-flag'], isEnabled: () => false }],
    })
    await client.init()

    expect(client.getVariant('gated-flag')).toBeNull()

    client.destroy()
  })

  it('retains the assigned variant across a 304 (not-modified) refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ...createMockResponse({
        defs: {
          'sticky-flag': { enabled: true, variant: 'treatment', configurationValue: 1 },
        },
      }),
      headers: { get: (name: string) => (name === 'X-Definitions-Revision' || name === 'ETag' ? 'rev-1' : null) },
    })

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    await client.init()
    expect(client.getVariant('sticky-flag')?.name).toBe('treatment')

    mockFetch.mockResolvedValueOnce(createMockResponse('', 304))
    await client.refresh()

    expect(client.getVariant('sticky-flag')).toEqual({
      name: 'treatment',
      configurationValue: 1,
    })

    client.destroy()
  })

  it('clears variants when switching a feature-defaults-only client to enableVariants off', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ defs: {} }))

    const client = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    expect(client.getVariant('anything')).toBeNull()
    expect(client.state.variants).toBeNull()

    client.destroy()
  })
})
