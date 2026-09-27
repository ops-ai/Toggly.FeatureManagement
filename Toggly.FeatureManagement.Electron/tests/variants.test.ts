import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ElectronTogglyClient,
  initToggly,
  getToggly,
  isFeatureOn,
  getVariant,
  getVariantValue,
  closeToggly,
  __resetTogglyForTests,
} from '../src/main/client.js'

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) =>
        headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response
}

const isColor = (v: unknown): v is { color: string } =>
  typeof v === 'object' && v !== null && typeof (v as { color?: unknown }).color === 'string'

describe('enableVariants', () => {
  let userDataPath: string

  beforeEach(async () => {
    __resetTogglyForTests()
    userDataPath = await mkdtemp(join(tmpdir(), 'toggly-electron-variants-'))
  })

  afterEach(async () => {
    closeToggly()
    __resetTogglyForTests()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('requests /evaluated-variants-signed instead of /evaluated-signed when enabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        onFeature: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
      }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-variants',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('/evaluated-variants-signed/app-variants/Production')
    expect(url).not.toContain('/evaluated-signed/')
  })

  it('uses /evaluated-signed when disabled (default)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, { onFeature: true }))
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-bool',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
    })
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('/evaluated-signed/app-bool/Production')
    expect(url).not.toContain('/evaluated-variants-signed')
  })

  it('projects variant defs onto boolean flags for isFeatureOn', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        onFeature: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
        offFeature: { enabled: false, variant: 'control' },
      }),
    )
    const flags = await initToggly({
      enableTelemetry: false,
      appKey: 'app-proj',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    expect(flags).toEqual({ onFeature: true, offFeature: false })
    expect(isFeatureOn('onFeature')).toBe(true)
    expect(isFeatureOn('offFeature')).toBe(false)
  })

  it('getVariant returns name and configurationValue when enabled and assigned', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        onFeature: { enabled: true, variant: 'treatment', configurationValue: { color: 'blue' } },
      }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-getvariant',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    expect(getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: { color: 'blue' } })
    expect(getVariantValue('onFeature')).toEqual({ color: 'blue' })
    expect(getVariantValue('onFeature', isColor)).toEqual({ color: 'blue' })
    expect(getVariantValue('onFeature', (v): v is number => typeof v === 'number')).toBeNull()
  })

  it('getVariant returns null when disabled, missing, or variants are off', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        offFeature: { enabled: false, variant: 'control', configurationValue: { color: 'red' } },
      }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-null',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    expect(getVariant('offFeature')).toBeNull()
    expect(getVariant('unknownFeature')).toBeNull()
    expect(getVariantValue('offFeature')).toBeNull()

    closeToggly()
    __resetTogglyForTests()
    const fetchOff = vi.fn().mockResolvedValue(mockResponse(200, { onFeature: true }))
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-disabled',
      userDataPath,
      fetch: fetchOff,
      enableLiveUpdates: false,
      enableVariants: false,
    })
    expect(getVariant('onFeature')).toBeNull()
  })

  it('getVariant returns null when the entry has no variant name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { onFeature: { enabled: true } }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-noname',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    expect(getVariant('onFeature')).toBeNull()
  })

  it('getVariant returns null when a local gate turns the feature off', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        onFeature: { enabled: true, variant: 'treatment', configurationValue: 42 },
      }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-gate',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    const client = getToggly()!
    expect(client.getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 })
    client.setLocalGates([{ id: 'device', flagKeys: ['onFeature'], isEnabled: () => false }])
    expect(client.getVariant('onFeature')).toBeNull()
  })

  it('keeps the variant assignment across an in-memory conditional 304 refresh', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(
          200,
          { onFeature: { enabled: true, variant: 'treatment', configurationValue: 42 } },
          { 'X-Definitions-Revision': 'rev-1' },
        ),
      )
      .mockResolvedValueOnce(mockResponse(304, '', { 'X-Definitions-Revision': 'rev-1' }))

    await initToggly({
      enableTelemetry: false,
      appKey: 'app-304',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
      identity: 'user-1',
    })
    expect(getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 })
    const client = getToggly()!
    const flags = await client.refresh()
    expect(flags.onFeature).toBe(true)
    expect(getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 })
  })

  it('restores the cached variant assignment from disk on a fresh client after a 304', async () => {
    const fetchFirst = vi.fn().mockResolvedValue(
      mockResponse(
        200,
        { onFeature: { enabled: true, variant: 'treatment', configurationValue: 42 } },
        { 'X-Definitions-Revision': 'rev-1' },
      ),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-304-cold',
      userDataPath,
      fetch: fetchFirst,
      enableLiveUpdates: false,
      enableVariants: true,
      identity: 'user-1',
    })
    closeToggly()
    __resetTogglyForTests()

    const fetchSecond = vi.fn().mockResolvedValue(mockResponse(304, '', { 'X-Definitions-Revision': 'rev-1' }))
    const flags = await initToggly({
      enableTelemetry: false,
      appKey: 'app-304-cold',
      userDataPath,
      fetch: fetchSecond,
      enableLiveUpdates: false,
      enableVariants: true,
      identity: 'user-1',
    })
    expect(flags.onFeature).toBe(true)
    expect(getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: 42 })
  })

  it('falls back to disk cache (with variants) when the network fails', async () => {
    const fetchOk = vi.fn().mockResolvedValue(
      mockResponse(
        200,
        { Cached: { enabled: true, variant: 'v1', configurationValue: 'x' } },
        { ETag: '"etag-1"' },
      ),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-cache-variants',
      userDataPath,
      fetch: fetchOk,
      enableLiveUpdates: false,
      enableVariants: true,
      identity: 'user-1',
    })
    closeToggly()

    const fetchFail = vi.fn().mockRejectedValue(new Error('network down'))
    const flags = await initToggly({
      enableTelemetry: false,
      appKey: 'app-cache-variants',
      userDataPath,
      fetch: fetchFail,
      enableLiveUpdates: false,
      enableVariants: true,
      identity: 'user-1',
    })
    expect(flags.Cached).toBe(true)
    expect(getVariant('Cached')).toEqual({ name: 'v1', configurationValue: 'x' })
  })

  it('does not read a boolean-mode disk cache entry when switching enableVariants on', async () => {
    const fetchBool = vi.fn().mockResolvedValue(mockResponse(200, { Shared: true }))
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-discriminator',
      userDataPath,
      fetch: fetchBool,
      enableLiveUpdates: false,
      enableVariants: false,
      identity: 'same-user',
    })
    closeToggly()
    __resetTogglyForTests()

    const fetchFail = vi.fn().mockRejectedValue(new Error('offline'))
    const flags = await initToggly({
      enableTelemetry: false,
      appKey: 'app-discriminator',
      userDataPath,
      fetch: fetchFail,
      enableLiveUpdates: false,
      enableVariants: true,
      identity: 'same-user',
      flagDefaults: { Shared: false },
    })
    // A different cache scope means the boolean-mode entry cannot be reused;
    // the client falls back to flagDefaults instead of the stale boolean cache.
    expect(flags.Shared).toBe(false)
    expect(getVariant('Shared')).toBeNull()
  })

  it('clears the cached variant assignment on setContext', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { onFeature: { enabled: true, variant: 'treatment' } }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-setcontext',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
    })
    expect(getVariant('onFeature')).toEqual({ name: 'treatment', configurationValue: undefined })

    const client = getToggly()!
    const fetchOther = vi.fn().mockResolvedValue(
      mockResponse(200, { onFeature: { enabled: true, variant: 'other-user-variant' } }),
    )
    ;(client as unknown as { fetchImpl: typeof fetch }).fetchImpl = fetchOther
    await client.setContext({ identity: 'someone-else' })
    expect(getVariant('onFeature')).toEqual({ name: 'other-user-variant', configurationValue: undefined })
  })

  it('rejects malformed evaluated-variants bodies', async () => {
    const onError = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, { onFeature: { enabled: 'yes' } }),
    )
    await initToggly({
      enableTelemetry: false,
      appKey: 'app-malformed',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableVariants: true,
      onError,
      flagDefaults: { Fallback: true },
    })
    expect(onError).toHaveBeenCalled()
    expect(isFeatureOn('Fallback')).toBe(true)
  })

  it('singleton helpers return null when not initialized', () => {
    expect(getVariant('x')).toBeNull()
    expect(getVariantValue('x')).toBeNull()
  })
})
