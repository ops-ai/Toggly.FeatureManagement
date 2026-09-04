import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../src/client'
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

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'AlwaysOnFlag',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

const orderContext = {
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

describe('local evaluation mode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches definitions-signed, not evaluated-signed', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

    const client = createTogglyClient({
      appKey: 'test-key',
      environment: 'Staging',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    const url = String(mockFetch.mock.calls[0]?.[0])
    expect(url).toContain('/definitions-signed/test-key/Staging')
    expect(url).not.toContain('/evaluated-signed/')

    client.destroy()
  })

  it('does not append ?u= even when identity is set', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-123',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    const url = String(mockFetch.mock.calls[0]?.[0])
    expect(url).not.toContain('u=')
    expect(url).not.toContain('user-123')

    client.destroy()
  })

  it('evaluates AlwaysOn locally', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('AlwaysOnFlag')).resolves.toBe(true)
    expect(client.getDefinitions().has('AlwaysOnFlag')).toBe(true)
    expect(client.state.features['AlwaysOnFlag']).toBe(true)

    client.destroy()
  })

  it('evaluates ContextProperty entity gates and fails closed without entity', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([entityGated]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('EntityGated')).resolves.toBe(false)
    await expect(client.isFeatureOn('EntityGated', orderContext)).resolves.toBe(true)

    client.destroy()
  })

  it('does not refresh on setIdentity in local mode', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-a',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await client.setIdentity('user-b')

    expect(client.identity).toBe('user-b')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    client.destroy()
  })

  it('hydrateDefinitions applies cached models without a fetch', () => {
    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })

    const features = client.hydrateDefinitions([alwaysOn])

    expect(features['AlwaysOnFlag']).toBe(true)
    expect(client.getDefinitions().has('AlwaysOnFlag')).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()

    client.destroy()
  })

  const countryFlag: FeatureDefinitionModel = {
    featureKey: 'CountryFlag',
    filters: [
      {
        name: 'Country',
        parameters: { Percentage: 100, 'Country:0': 'US' },
      },
    ],
  }

  const browserFlag: FeatureDefinitionModel = {
    featureKey: 'BrowserFlag',
    filters: [
      {
        name: 'BrowserFamily',
        parameters: { Percentage: 100, 'BrowserFamily:0': 'Chrome' },
      },
    ],
  }

  const claimsFlag: FeatureDefinitionModel = {
    featureKey: 'ClaimsFlag',
    filters: [
      {
        name: 'UserClaims',
        parameters: { Percentage: 100, Claim: 'role', Value: 'admin' },
      },
    ],
  }

  const groupsFlag: FeatureDefinitionModel = {
    featureKey: 'GroupsFlag',
    filters: [
      {
        name: 'Targeting',
        parameters: {
          'Audience.Groups:0': 'beta',
          'Audience.DefaultRolloutPercentage': 0,
        },
      },
    ],
  }

  const chromeUA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  it('evaluates Country from request.country override', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([countryFlag]))

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
      client.isFeatureOn('CountryFlag', null, undefined, {
        request: { country: 'us' },
      }),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('evaluates BrowserFamily from request.userAgent override', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([browserFlag]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-1',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(
      client.isFeatureOn('BrowserFlag', null, undefined, {
        request: { userAgent: chromeUA },
      }),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('per-call claims override config claims', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([claimsFlag]))

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
      client.isFeatureOn('ClaimsFlag', null, undefined, {
        claims: { role: 'admin' },
      }),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('per-call groups override config groups', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([groupsFlag]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-1',
      groups: [],
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(client.isFeatureOn('GroupsFlag')).resolves.toBe(false)
    await expect(
      client.isFeatureOn('GroupsFlag', null, undefined, {
        groups: ['beta'],
      }),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('string identity override remains backward-compatible', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([alwaysOn]))

    const client = createTogglyClient({
      appKey: 'test-key',
      evaluationMode: 'local',
      identity: 'user-a',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    await expect(
      client.isFeatureOn('AlwaysOnFlag', null, undefined, 'user-b'),
    ).resolves.toBe(true)

    client.destroy()
  })

  it('defaults to remote rail when evaluationMode is unset', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          features: [{ featureKey: 'feature-a', enabled: true }],
        }),
      json: async () => ({
        features: [{ featureKey: 'feature-a', enabled: true }],
      }),
      headers: { get: () => null },
    })

    const client = createTogglyClient({
      appKey: 'test-key',
      identity: 'user-123',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await client.init()

    const url = String(mockFetch.mock.calls[0]?.[0])
    expect(url).toContain('/evaluated-signed/')
    expect(url).not.toContain('/definitions-signed/')
    expect(client.config.evaluationMode).toBeUndefined()

    client.destroy()
  })
})
