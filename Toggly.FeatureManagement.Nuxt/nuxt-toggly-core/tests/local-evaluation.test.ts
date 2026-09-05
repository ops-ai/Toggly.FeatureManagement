import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearRegisteredContexts } from '@ops-ai/toggly-hooks-types'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'
import { createTogglyClient } from '../src/client'

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

const definitionsPayload: FeatureDefinitionModel[] = [
  { featureKey: 'PlainOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'PlainOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  entityGated,
]

describe('local evaluation mode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearRegisteredContexts()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    delete (globalThis as { WebSocket?: unknown }).WebSocket
  })

  afterEach(() => {
    clearRegisteredContexts()
    vi.restoreAllMocks()
  })

  it('defaults evaluationMode to remote', () => {
    const client = createTogglyClient()
    expect(client.config.evaluationMode).toBe('remote')
    client.destroy()
  })

  it('fetches definitions-signed without identity query params', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      environment: 'Staging',
      identity: 'user-123',
      groups: ['beta'],
      claims: { plan: 'pro' },
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const url = String(mockFetch.mock.calls[0]?.[0])
    expect(url).toContain('/definitions-signed/test-key/Staging')
    expect(url).not.toContain('/evaluated-signed/')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('u')).toBeNull()
    expect(parsed.searchParams.get('g')).toBeNull()

    client.destroy()
  })

  it('evaluates AlwaysOn / AlwaysOff from stored definitions', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('PlainOn')).resolves.toBe(true)
    await expect(client.isFeatureOn('PlainOff')).resolves.toBe(false)
    expect(client.state.definitions.size).toBe(3)

    client.destroy()
  })

  it('fails closed for ContextProperty entity gates without context', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('EntityGated')).resolves.toBe(false)

    client.destroy()
  })

  it('evaluates ContextProperty entity gates with matching attributes', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('EntityGated', orderContext)).resolves.toBe(true)
    await expect(
      client.isFeatureOn('EntityGated', {
        kind: 'Order',
        key: '2',
        attributes: { BirthDate: '2020-01-01T00:00:00Z' },
      }),
    ).resolves.toBe(false)

    client.destroy()
  })

  it('evaluates entity gates via registerContext mapper', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
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

  it('does not refresh on setIdentity in local mode', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'initial-user',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await client.setIdentity('new-user')

    expect(client.identity).toBe('new-user')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    client.destroy()
  })

  it('applies local gates after toggly-eval in local mode', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse(definitionsPayload))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
      localGates: [
        {
          id: 'deviceGate',
          flagKeys: ['PlainOn'],
          isEnabled: () => false,
        },
      ],
    })
    await client.init()

    await expect(client.isFeatureOn('PlainOn')).resolves.toBe(false)

    client.destroy()
  })

  it('evaluates identityOverride without mutating client.identity', async () => {
    const targetingAlice: FeatureDefinitionModel = {
      featureKey: 'targeted-flag',
      filters: [
        {
          name: 'Targeting',
          parameters: {
            'Audience.Users:0': 'alice',
            'Audience.DefaultRolloutPercentage': 0,
          },
        },
      ],
    }
    mockFetch.mockResolvedValueOnce(createMockResponse([targetingAlice]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'bob',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('targeted-flag')).resolves.toBe(false)
    await expect(
      client.isFeatureOn('targeted-flag', undefined, undefined, 'alice'),
    ).resolves.toBe(true)
    expect(client.identity).toBe('bob')

    client.destroy()
  })

  it('evaluates Country from request.country override', async () => {
    const countryFlag: FeatureDefinitionModel = {
      featureKey: 'CountryFlag',
      filters: [
        {
          name: 'Country',
          parameters: { Percentage: 100, 'Country:0': 'US' },
        },
      ],
    }
    mockFetch.mockResolvedValueOnce(createMockResponse([countryFlag]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-1',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('CountryFlag')).resolves.toBe(false)
    await expect(
      client.isFeatureOn('CountryFlag', undefined, undefined, {
        request: { country: 'us' },
      }),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('per-call claims override config claims', async () => {
    const claimsFlag: FeatureDefinitionModel = {
      featureKey: 'ClaimsFlag',
      filters: [
        {
          name: 'UserClaims',
          parameters: { Percentage: 100, Claim: 'role', Value: 'admin' },
        },
      ],
    }
    mockFetch.mockResolvedValueOnce(createMockResponse([claimsFlag]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-1',
      claims: { role: 'user' },
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('ClaimsFlag')).resolves.toBe(false)
    await expect(
      client.isFeatureOn('ClaimsFlag', undefined, undefined, {
        claims: { role: 'admin' },
      }),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('hydrateDefinitions applies cached models without a fetch', () => {
    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })

    const features = client.hydrateDefinitions([
      { featureKey: 'PlainOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    ])

    expect(features.PlainOn).toBe(true)
    expect(client.getDefinitions().has('PlainOn')).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()

    client.destroy()
  })

  it('keeps remote evaluated-signed URL when evaluationMode is remote', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      }),
    )

    const client = createTogglyClient({
      appKey: 'test-key',
      identity: 'user-123',
      evaluationMode: 'remote',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    const url = String(mockFetch.mock.calls[0]?.[0])
    expect(url).toContain('/evaluated-signed/test-key/')
    expect(url).not.toContain('/definitions-signed/')

    client.destroy()
  })
})
