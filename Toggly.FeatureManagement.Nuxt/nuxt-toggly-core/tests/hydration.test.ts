import { afterEach, expect, it, vi } from 'vitest'
import { createTogglyClient } from '../src/client'

afterEach(() => vi.unstubAllGlobals())

it('hydrates copied evaluated state for public checks and observers without initializing or changing fallback defaults', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const client = createTogglyClient({ identity: 'alice', featureDefaults: { Enabled: true }, enableLiveUpdates: false })
  const changes: unknown[] = []
  client.subscribeFeaturesRefresh(() => changes.push(client.state.features.Targeted))
  const snapshot = { Targeted: true, Disabled: false }
  try {
    client.hydrateEvaluatedFeatures(snapshot)
    snapshot.Targeted = false
    expect(await client.isFeatureOn('Targeted')).toBe(true)
    expect(await client.isFeatureOff('Disabled')).toBe(true)
    expect(await client.evaluateFeatureGate(['Targeted', 'Disabled'], 'all')).toBe(false)
    expect(await client.evaluateFeatureGate(['Targeted', 'Disabled'], 'any')).toBe(true)
    expect(await client.evaluateFeatureGate(['Disabled'], 'all', true)).toBe(true)
    expect(client.state.features.Targeted).toBe(true)
    expect(changes).toEqual([true])
    expect(client.state.initialized).toBe(false)
    expect(client.config.featureDefaults).toEqual({ Enabled: true })
    expect(fetch).not.toHaveBeenCalled()
  } finally { client.destroy() }
})

it('discards the prior users hydrated enables on a successful identity change with an empty response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{}', { status: 200 })))
  const client = createTogglyClient({ appKey: 'fixture', identity: 'alice', featureDefaults: { Enabled: true }, refreshInterval: 0, enableLiveUpdates: false })
  try {
    await client.init()
    client.hydrateEvaluatedFeatures({ Targeted: true })
    await client.setIdentity('bob')
    expect(client.identity).toBe('bob')
    expect(await client.isFeatureOn('Targeted')).toBe(false)
    expect(await client.isFeatureOn('Enabled')).toBe(true)
    expect(client.state.features.Targeted).toBeUndefined()
  } finally { client.destroy() }
})

it('rejects nonboolean and local-mode snapshots before changing state, and ignores hydration after destruction', () => {
  const client = createTogglyClient({ featureDefaults: { Enabled: true } })
  expect(() => client.hydrateEvaluatedFeatures({ Targeted: 'true' } as any)).toThrow(TypeError)
  expect(client.state.features).toEqual({ Enabled: true })
  client.hydrateEvaluatedFeatures({})
  expect(client.state.features).toEqual({})
  client.destroy()
  client.hydrateEvaluatedFeatures({ Targeted: true })
  expect(client.state.features).toEqual({})
  const local = createTogglyClient({ evaluationMode: 'local', featureDefaults: { Enabled: true } })
  try {
    expect(() => local.hydrateEvaluatedFeatures({ Targeted: true })).toThrow()
    expect(local.state.features).toEqual({ Enabled: true })
  } finally { local.destroy() }
})


it.each(['setIdentity', 'identity', 'init'])('withholds hydrated enables when %s changes identity before initialization', async method => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const client = createTogglyClient({ appKey: 'fixture', identity: 'alice', featureDefaults: { Enabled: true }, refreshInterval: 0, enableLiveUpdates: false })
  try {
    client.hydrateEvaluatedFeatures({ Targeted: true })
    if (method === 'setIdentity') await client.setIdentity('bob')
    else if (method === 'identity') client.identity = 'bob'
    else await client.init({ identity: 'bob' })
    expect(client.identity).toBe('bob')
    expect(await client.isFeatureOn('Targeted')).toBe(false)
    expect(client.state.features).toEqual({ Enabled: true })
  } finally { client.destroy() }
})
