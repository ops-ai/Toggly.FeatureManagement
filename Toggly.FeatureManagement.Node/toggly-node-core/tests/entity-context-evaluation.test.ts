import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTogglyClient, closeToggly } from '../src/client'
import { clearRegisteredContexts } from '@ops-ai/toggly-hooks-types'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

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

const orderContext = {
  kind: 'Order',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
}

async function createClient() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () =>
      JSON.stringify([
        { featureKey: 'PlainOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
        { featureKey: 'PlainOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
        entityGated,
      ]),
    json: async () => [
      { featureKey: 'PlainOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
      { featureKey: 'PlainOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
      entityGated,
    ],
  })

  const client = createTogglyClient({
    appKey: 'test-app',
    registerContextsOnStartup: false,
  })
  await client.init()
  return client
}

describe('entity context read-time evaluation', () => {
  beforeEach(() => {
    clearRegisteredContexts()
    closeToggly()
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    clearRegisteredContexts()
    closeToggly()
    vi.restoreAllMocks()
  })

  it('leaves plain booleans unchanged without context', async () => {
    const client = await createClient()
    await expect(client.isFeatureOn('PlainOn')).resolves.toBe(true)
    await expect(client.isFeatureOn('PlainOff')).resolves.toBe(false)
  })

  it('fails closed for entity gates without context', async () => {
    const client = await createClient()
    await expect(client.isFeatureOn('EntityGated')).resolves.toBe(false)
  })

  it('evaluates entity gates with matching attributes', async () => {
    const client = await createClient()
    await expect(client.isFeatureOn('EntityGated', undefined, orderContext)).resolves.toBe(true)
  })

  it('fails closed when a mapped entity is missing the rule attribute', async () => {
    const client = await createClient()
    client.registerContext<{ id: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: {},
    }))
    await expect(client.isFeatureOn('EntityGated', undefined, { id: '9' }, 'Order')).resolves.toBe(
      false,
    )
  })

  it('evaluates entity gates via registerContext mapper', async () => {
    const client = await createClient()
    client.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }))

    await expect(
      client.isFeatureOn(
        'EntityGated',
        undefined,
        { id: '7', birthDate: '2026-06-15T00:00:00Z' },
        'Order',
      ),
    ).resolves.toBe(true)
    await expect(
      client.isFeatureOn(
        'EntityGated',
        undefined,
        { id: '8', birthDate: '2020-01-01T00:00:00Z' },
        'Order',
      ),
    ).resolves.toBe(false)
  })
})
