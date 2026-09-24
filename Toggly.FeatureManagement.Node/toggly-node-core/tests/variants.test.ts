import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTogglyClient, closeToggly } from '../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function variantDef(overrides: Partial<FeatureDefinitionModel> = {}): FeatureDefinitionModel {
  return {
    featureKey: 'checkout-flow',
    filters: [{ name: 'AlwaysOn' }],
    variants: [
      { name: 'A', configurationValue: { color: 'blue' } },
      { name: 'B', configurationValue: { color: 'green' } },
    ],
    allocation: {
      defaultWhenEnabled: 'B',
      user: [{ variant: 'A', users: ['alice'] }],
    },
    ...overrides,
  }
}

function defsResponse(definitions: FeatureDefinitionModel[]) {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify(definitions),
    json: async () => definitions,
  }
}

describe('getVariant / getVariantValue (catalog-local, MF-parity)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(() => {
    closeToggly()
  })

  it('resolves the user-allocated variant for a matching identity', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([variantDef()]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    const variant = await client.getVariant('checkout-flow', { identity: 'alice' })

    expect(variant).toEqual({ name: 'A', configurationValue: { color: 'blue' } })
  })

  it('falls back to defaultWhenEnabled for a non-matching identity', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([variantDef()]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    const variant = await client.getVariant('checkout-flow', { identity: 'carol' })

    expect(variant).toEqual({ name: 'B', configurationValue: { color: 'green' } })
  })

  it('returns null for an unknown feature key', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([variantDef()]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getVariant('does-not-exist')).toBeNull()
  })

  it('returns null when the feature is disabled for this context', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        variantDef({
          filters: [{ name: 'AlwaysOff' }],
          allocation: { defaultWhenDisabled: 'B', defaultWhenEnabled: null },
        }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    // Microsoft.FeatureManagement itself would still resolve variant "B" via
    // defaultWhenDisabled here; the Node SDK's getVariant intentionally
    // collapses that to null to match the ecosystem's disabled-means-null
    // convention (see VariantResult docs).
    expect(await client.getVariant('checkout-flow')).toBeNull()
  })

  it('returns null when no variants are configured at all', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([variantDef({ variants: undefined, allocation: undefined })]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getVariant('checkout-flow')).toBeNull()
  })

  it('getVariantValue unwraps configurationValue and defaults to null', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([variantDef()]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    expect(await client.getVariantValue('checkout-flow', { identity: 'alice' })).toEqual({
      color: 'blue',
    })
    expect(await client.getVariantValue('does-not-exist')).toBeNull()
  })

  it('getVariantValue soft-decodes with an optional type guard', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        variantDef(),
        variantDef({
          featureKey: 'pricing-tier',
          variants: [{ name: 'A', configurationValue: 7 }],
          allocation: { defaultWhenEnabled: 'A' },
        }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    const isCheckout = (v: unknown): v is { color: string } =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { color?: unknown }).color === 'string'

    expect(
      await client.getVariantValue<{ color: string }>(
        'checkout-flow',
        { identity: 'alice' },
        undefined,
        undefined,
        isCheckout,
      ),
    ).toEqual({ color: 'blue' })
    expect(
      await client.getVariantValue<{ color: string }>(
        'pricing-tier',
        undefined,
        undefined,
        undefined,
        isCheckout,
      ),
    ).toBeNull()
    expect(
      await client.getVariantValue<{ color: string }>(
        'does-not-exist',
        undefined,
        undefined,
        undefined,
        isCheckout,
      ),
    ).toBeNull()
    expect(await client.getVariantValue<number>('pricing-tier')).toBe(7)
  })

  it('honors variantIgnoreCase for case-insensitive user matching', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([variantDef()]))
    const client = createTogglyClient({ appKey: 'test-app', variantIgnoreCase: true })
    await client.init()

    const variant = await client.getVariant('checkout-flow', { identity: 'Alice' })

    expect(variant).toEqual({ name: 'A', configurationValue: { color: 'blue' } })
  })

  it('stays case-sensitive by default (MF parity default)', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([variantDef()]))
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    const variant = await client.getVariant('checkout-flow', { identity: 'Alice' })

    // Mismatched case with ignoreCase unset → falls back to defaultWhenEnabled.
    expect(variant).toEqual({ name: 'B', configurationValue: { color: 'green' } })
  })

  it('passes entity/kind through to catalog-local allocation like isFeatureOn', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([
        variantDef({
          allocation: { defaultWhenEnabled: 'B', group: [{ variant: 'A', groups: ['beta'] }] },
        }),
      ]),
    )
    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    const variant = await client.getVariant('checkout-flow', { groups: ['beta'] })

    expect(variant).toEqual({ name: 'A', configurationValue: { color: 'blue' } })
  })
})
