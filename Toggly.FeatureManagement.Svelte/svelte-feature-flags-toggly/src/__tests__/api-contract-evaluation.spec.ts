/**
 * Public-entry flag evaluation against the Toggly evaluated-signed /
 * evaluated-variants-signed API contract (mocked HTTP with realistic payloads).
 *
 * This client SDK consumes server-pre-evaluated flag maps; docs/filter-parity
 * fixtures and the variant-allocator corpus apply to local-eval SDKs, not here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { get } from 'svelte/store'
import { render, waitFor } from '@testing-library/svelte'
import { createToggly } from '../utils/createToggly'
import {
  togglyServiceStore,
  togglyFlagsStore,
  togglyVariantsStore,
  createFeatureStore,
  createVariantStore,
  createVariantValueStore,
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
} from '../stores/toggly.store'
import { createMockFetchResponse } from './test-helpers'
import FeatureContractHost from './FeatureContractHost.svelte'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

async function resetStores(): Promise<void> {
  const service = get(togglyServiceStore)
  service?.dispose()
  togglyServiceStore.set(null)
  togglyFlagsStore.set({})
  togglyVariantsStore.set({})
}

describe('evaluated-signed API contract evaluation', () => {
  beforeEach(async () => {
    mockFetch.mockReset()
    localStorage.clear()
    await resetStores()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    await resetStores()
    vi.restoreAllMocks()
  })

  it('fetches evaluated-signed and evaluates through public stores/APIs', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse(
        { defs: { FlagOn: true, FlagOff: false } },
        200,
        'OK',
      ),
    )

    await createToggly({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      identity: 'alice',
      groups: ['staff'],
      claims: { plan: 'pro' },
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
      featureFlagsRefreshInterval: 0,
    })

    expect(await isFeatureOn('FlagOn')).toBe(true)
    expect(await isFeatureOff('FlagOff')).toBe(true)
    expect(await isFeatureOn('Missing')).toBe(false)
    expect(await evaluateFeatureGate(['FlagOn', 'FlagOff'], 'any')).toBe(true)
    expect(await evaluateFeatureGate(['FlagOn', 'FlagOff'], 'all')).toBe(false)
    expect(await evaluateFeatureGate(['FlagOff'], 'all', true)).toBe(true)

    expect(get(togglyFlagsStore)).toEqual({ FlagOn: true, FlagOff: false })
    expect(get(createFeatureStore('FlagOn'))).toBe(true)
    expect(get(createFeatureStore('FlagOff'))).toBe(false)

    const calledUrl = String(mockFetch.mock.calls[0][0])
    expect(calledUrl).toContain('/evaluated-signed/contract-app/Production')
    expect(calledUrl).not.toContain('/definitions-signed/')
    expect(calledUrl).not.toContain('/evaluated-variants-signed/')
    const query = new URL(calledUrl).searchParams
    expect(query.get('u')).toBe('alice')
    expect(query.getAll('g')).toEqual(['staff'])
    expect(query.get('claim.plan')).toBe('pro')
  })

  it('accepts flat evaluated-signed FeatureFlags body (no defs wrapper)', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse({ FlagOn: true, FlagOff: false }, 200, 'OK'),
    )

    await createToggly({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
      featureFlagsRefreshInterval: 0,
    })

    expect(await isFeatureOn('FlagOn')).toBe(true)
    expect(await isFeatureOn('FlagOff')).toBe(false)
    expect(await evaluateFeatureGate(['FlagOn', 'FlagOff'], 'any')).toBe(true)
  })

  it('fetches evaluated-variants-signed and exposes variants via public APIs', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse(
        {
          defs: {
            FlagOn: { enabled: true, variant: 'blue', configurationValue: 7 },
            FlagOff: { enabled: false, variant: 'control' },
          },
        },
        200,
        'OK',
      ),
    )

    await createToggly({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
      enableVariants: true,
      featureFlagsRefreshInterval: 0,
    })

    const service = get(togglyServiceStore)
    expect(service).toBeTruthy()
    expect(await isFeatureOn('FlagOn')).toBe(true)
    expect(await isFeatureOff('FlagOff')).toBe(true)
    expect(service!.getVariant('FlagOn')).toEqual({
      name: 'blue',
      configurationValue: 7,
    })
    expect(service!.getVariantValue('FlagOn')).toBe(7)
    expect(get(createVariantStore('FlagOn'))).toEqual({
      name: 'blue',
      configurationValue: 7,
    })
    expect(get(createVariantValueStore('FlagOn'))).toBe(7)

    const calledUrl = String(mockFetch.mock.calls[0][0])
    expect(calledUrl).toContain('/evaluated-variants-signed/contract-app/Production')
  })

  it('drives Feature and FeatureGateBuilder from evaluated defs', async () => {
    mockFetch.mockResolvedValue(
      createMockFetchResponse(
        {
          defs: {
            FlagOn: { enabled: true, variant: 'blue', configurationValue: 'payload' },
            FlagOff: { enabled: false, variant: 'control' },
          },
        },
        200,
        'OK',
      ),
    )

    await createToggly({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
      enableVariants: true,
      featureFlagsRefreshInterval: 0,
    })

    expect(await isFeatureOn('FlagOn')).toBe(true)

    const { getByTestId, queryByTestId } = render(FeatureContractHost)

    await waitFor(() => {
      expect(getByTestId('feature-on').textContent).toBe('visible')
      expect(queryByTestId('feature-off')).toBeNull()
      expect(getByTestId('builder').textContent).toBe('true')
    })
  })
})
