import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel } from '@ops-ai/nextjs-toggly-core'

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>) => fn,
}))

import {
  cachedEvaluateFeatureGate,
  cachedGetFeatures,
  cachedIsFeatureOn,
} from '../src/cache'
import { initServerToggly, resetServerToggly } from '../src/server-client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const entityGated: FeatureDefinitionModel = {
  featureKey: 'EntityGated',
  requirementType: 'Any',
  contextRequirementType: 'All',
  filters: [
    {
      name: 'ContextProperty',
      parameters: {
        Property: 'BirthDate',
        Operator: 'gt',
        Value: '2026-01-01',
        ValueType: 'datetime',
      },
    },
    { name: 'AlwaysOn', parameters: {} },
  ],
}

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'AlwaysOnFlag',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

const orderOn = {
  kind: 'Order',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
}

function defsResponse(definitions: FeatureDefinitionModel[]) {
  const body = JSON.stringify(definitions)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    json: async () => definitions,
    headers: { get: () => null },
  }
}

describe('cached feature helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
    vi.restoreAllMocks()
  })

  it('fails closed when the server client is missing', async () => {
    await expect(cachedIsFeatureOn('EntityGated')).resolves.toBe(false)
    await expect(cachedEvaluateFeatureGate(['EntityGated'])).resolves.toBe(
      false
    )
    await expect(cachedGetFeatures()).resolves.toEqual({})
  })

  it('evaluates entity context through the cache wrapper', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([entityGated, alwaysOn]))
    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
    })

    await expect(
      cachedIsFeatureOn('EntityGated', {
        context: orderOn,
        contextKind: 'Order',
      })
    ).resolves.toBe(true)

    await expect(
      cachedEvaluateFeatureGate(['EntityGated', 'AlwaysOnFlag'], {
        context: orderOn,
        requirement: 'all',
      })
    ).resolves.toBe(true)

    const snapshot = await cachedGetFeatures()
    expect(snapshot.AlwaysOnFlag).toBe(true)
    expect(snapshot.EntityGated).toBe(false)
  })
})
