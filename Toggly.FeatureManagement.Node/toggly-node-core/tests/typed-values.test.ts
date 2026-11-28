import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTogglyClient, closeToggly } from '../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

/**
 * Typed flag value getters (OPS-2102): getStringValue, getNumberValue,
 * getJsonValue, getDateTimeValue. Mirrors the React/Vue typed-values specs.
 *
 * `valueType` / flag-level `value` / `configurationValue` are not yet
 * declared on the published `FeatureDefinitionModel`, so definitions are
 * built as plain objects here rather than through `Partial<...>`.
 */
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function typedDef(overrides: Record<string, unknown> = {}): FeatureDefinitionModel {
  return {
    featureKey: 'theme',
    filters: [{ name: 'AlwaysOn' }],
    ...overrides,
  } as FeatureDefinitionModel
}

function defsResponse(definitions: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify(definitions),
    json: async () => definitions,
  }
}

describe('typed flag value getters (OPS-2102)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(() => {
    closeToggly()
  })

  it('getStringValue decodes a matching catalog value', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([typedDef({ valueType: 'string', value: 'dark' })]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getStringValue('theme')).toBe('dark')
  })

  it('getStringValue returns null when the feature is disabled', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        typedDef({ filters: [{ name: 'AlwaysOff' }], valueType: 'string', value: 'dark' }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getStringValue('theme')).toBeNull()
  })

  it('getStringValue falls back to configurationValue when value is absent', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([typedDef({ valueType: 'string', configurationValue: 'light' })]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getStringValue('theme')).toBe('light')
  })

  it('getStringValue soft-nulls on a declared valueType mismatch', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([typedDef({ featureKey: 'limit', valueType: 'number', value: 5 })]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getStringValue('limit')).toBeNull()
  })

  it('getStringValue returns null for an unknown feature key', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([typedDef()]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getStringValue('does-not-exist')).toBeNull()
  })

  it('getNumberValue decodes a matching catalog value', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([typedDef({ featureKey: 'limit', valueType: 'number', value: 42 })]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getNumberValue('limit')).toBe(42)
  })

  it('getJsonValue decodes an object value', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        typedDef({ featureKey: 'config', valueType: 'json', value: { retries: 3 } }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getJsonValue('config')).toEqual({ retries: 3 })
  })

  it('getDateTimeValue decodes an ISO-8601 string to a Date', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        typedDef({
          featureKey: 'launch-at',
          valueType: 'datetime',
          value: '2026-01-15T10:30:00Z',
        }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    const decoded = await client.getDateTimeValue('launch-at')
    expect(decoded).toBeInstanceOf(Date)
    expect(decoded?.toISOString()).toBe('2026-01-15T10:30:00.000Z')
  })

  it('getDateTimeValue soft-nulls on an unparsable value', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        typedDef({ featureKey: 'launch-at', valueType: 'datetime', value: 'not-a-date' }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getDateTimeValue('launch-at')).toBeNull()
  })

  it('legacy catalogs without a declared valueType still attempt the decode', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([typedDef({ value: 'dark' })]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getStringValue('theme')).toBe('dark')
  })
})
