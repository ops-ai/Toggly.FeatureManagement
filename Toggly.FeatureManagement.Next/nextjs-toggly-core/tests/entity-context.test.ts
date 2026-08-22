import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types'
import { createTogglyClient } from '../src/client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const datetimeGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
}

const orderContext = {
  kind: 'Order',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
}

function createClient() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () =>
      JSON.stringify({ defs: { PlainOn: true, PlainOff: false, EntityGated: datetimeGate } }),
    json: async () => ({ defs: { PlainOn: true, PlainOff: false, EntityGated: datetimeGate } }),
    headers: { get: () => null },
  })

  return createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
}

describe('entity context evaluation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearRegisteredContexts()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    clearRegisteredContexts()
    vi.restoreAllMocks()
  })

  it('fails closed for an entity gate evaluated without context', async () => {
    const client = createClient()
    await client.init()

    await expect(client.isFeatureOn('EntityGated')).resolves.toBe(false)
    await expect(client.isFeatureOff('EntityGated')).resolves.toBe(true)

    client.destroy()
  })

  it('evaluates an entity gate against a supplied context', async () => {
    const client = createClient()
    await client.init()

    await expect(client.isFeatureOn('EntityGated', orderContext)).resolves.toBe(true)
    await expect(client.isFeatureOff('EntityGated', orderContext)).resolves.toBe(false)

    client.destroy()
  })

  it('maps a domain object through a registered context mapper', async () => {
    const client = createClient()
    await client.init()

    client.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }))

    await expect(
      client.isFeatureOn('EntityGated', { id: '7', birthDate: '2026-06-15T00:00:00Z' }, 'Order'),
    ).resolves.toBe(true)
    await expect(
      client.isFeatureOn('EntityGated', { id: '8', birthDate: '2020-01-01T00:00:00Z' }, 'Order'),
    ).resolves.toBe(false)

    client.destroy()
  })

  it('leaves plain boolean definitions untouched', async () => {
    const client = createClient()
    await client.init()

    await expect(client.isFeatureOn('PlainOn')).resolves.toBe(true)
    await expect(client.isFeatureOn('PlainOff')).resolves.toBe(false)

    client.destroy()
  })

  it('threads context through all and any gates', async () => {
    const client = createClient()
    await client.init()

    await expect(
      client.evaluateFeatureGate(['PlainOn', 'EntityGated'], 'all', false, orderContext),
    ).resolves.toBe(true)
    await expect(
      client.evaluateFeatureGate(['PlainOn', 'EntityGated'], 'all'),
    ).resolves.toBe(false)
    await expect(
      client.evaluateFeatureGate(['PlainOff', 'EntityGated'], 'any', false, orderContext),
    ).resolves.toBe(true)
    await expect(
      client.evaluateFeatureGate(['PlainOff', 'EntityGated'], 'any'),
    ).resolves.toBe(false)

    client.destroy()
  })

  it('keeps local gates authoritative over an open entity gate', async () => {
    const client = createClient()
    await client.init()

    client.setLocalGates([
      { id: 'devicePaired', flagKeys: ['EntityGated'], isEnabled: () => false },
    ])

    await expect(client.isFeatureOn('EntityGated', orderContext)).resolves.toBe(false)

    client.destroy()
  })

  it('parses a legacy unsigned definition array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify([{ featureKey: 'legacy-on', filters: [{ name: 'AlwaysOn' }] }]),
      json: async () => [{ featureKey: 'legacy-on', filters: [{ name: 'AlwaysOn' }] }],
      headers: { get: () => null },
    })

    const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
    await client.init()

    await expect(client.isFeatureOn('legacy-on')).resolves.toBe(true)

    client.destroy()
  })

  it('uses feature defaults for gates after destroy', async () => {
    const client = createClient()
    await client.init()
    client.destroy()

    await expect(
      client.evaluateFeatureGate(['PlainOn'], 'all', false),
    ).resolves.toBe(false)

    const withDefaults = createTogglyClient({
      appKey: 'test-key',
      refreshInterval: 0,
      featureDefaults: { PlainOn: true },
    })
    withDefaults.destroy()

    await expect(
      withDefaults.evaluateFeatureGate(['PlainOn'], 'all', false),
    ).resolves.toBe(true)
  })
})
