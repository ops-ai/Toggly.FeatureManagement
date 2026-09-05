import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TogglyEdgeClient,
  createEdgeClient,
  initEdgeToggly,
  getEdgeToggly,
  resetEdgeToggly,
} from '../src/edge-client'
import type { FeatureDefinitionModel } from '@ops-ai/nextjs-toggly-core'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(data: unknown, status = 200) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
  }
}

function alwaysOn(featureKey: string): FeatureDefinitionModel {
  return {
    featureKey,
    filters: [{ name: 'AlwaysOn', parameters: {} }],
  }
}

function targeting(featureKey: string, identity: string): FeatureDefinitionModel {
  return {
    featureKey,
    filters: [
      {
        name: 'Targeting',
        parameters: {
          'Audience.Users:0': identity,
          'Audience.DefaultRolloutPercentage': 0,
        },
      },
    ],
  }
}

describe('TogglyEdgeClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetEdgeToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetEdgeToggly()
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should create a client with default config', () => {
      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      expect(client.identity).toBeDefined()
    })

    it('should initialize with feature defaults', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })

      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
    })

    it('fetches definitions-signed without identity query params', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([alwaysOn('feature-a')]))

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        identity: 'user-123',
        groups: ['beta'],
        claims: { plan: 'pro' },
        cache: false,
      })
      await client.init()

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = mockFetch.mock.calls[0]
      expect(String(url)).toContain('/definitions-signed/')
      expect(String(url)).not.toContain('u=')
      expect(String(url)).not.toContain('g=')
      expect(client.isFeatureOnSync('feature-a')).toBe(true)
    })

    it('evaluates entity gates with per-call context', async () => {
      const entityFlag: FeatureDefinitionModel = {
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
      mockFetch.mockResolvedValueOnce(createMockResponse([entityFlag]))

      const client = new TogglyEdgeClient({ appKey: 'test-key', cache: false })
      await client.init()

      expect(client.isFeatureOnSync('EntityGated')).toBe(false)
      expect(
        client.isFeatureOnSync(
          'EntityGated',
          undefined,
          {
            kind: 'Order',
            key: '1',
            attributes: { BirthDate: '2026-06-15T00:00:00Z' },
          },
        ),
      ).toBe(true)
    })

    it('reads text() and falls back when verifySignatures gets invalid envelope', async () => {
      const invalidBody = JSON.stringify({ defs: { 'feature-a': true } })
      const text = vi.fn().mockResolvedValue(invalidBody)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text,
        json: async () => JSON.parse(invalidBody),
      })

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        verifySignatures: true,
        featureDefaults: { 'feature-a': false },
      })
      await client.init()

      expect(text).toHaveBeenCalled()
      expect(client.isFeatureOnSync('feature-a')).toBe(false)
    })
  })

  describe('feature evaluation', () => {
    it('should evaluate single feature', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([alwaysOn('feature-a')]),
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.isFeatureOn('feature-a')

      expect(result).toBe(true)
    })

    it('should evaluate feature off', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([{ featureKey: 'feature-a', filters: [] }]),
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.isFeatureOff('feature-a')

      expect(result).toBe(true)
    })

    it('should evaluate feature gate with all requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([alwaysOn('feature-a'), alwaysOn('feature-b')]),
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'all',
      )

      expect(result).toBe(true)
    })

    it('should evaluate feature gate with any requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          alwaysOn('feature-a'),
          { featureKey: 'feature-b', filters: [] },
        ]),
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'any',
      )

      expect(result).toBe(true)
    })

    it('should evaluate feature gate with negate', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([alwaysOn('feature-a')]),
      )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })
      const result = await client.evaluateFeatureGate(
        ['feature-a'],
        'all',
        true,
      )

      expect(result).toBe(false)
    })

    it('evaluates concurrent identities via overrides without mutating singleton', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([targeting('vip-only', 'alice')]),
      )

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        identity: 'shared',
        cache: false,
      })
      await client.init()
      const sharedBefore = client.identity

      const [alice, bob] = await Promise.all([
        client.isFeatureOn('vip-only', { identity: 'alice' }),
        client.isFeatureOn('vip-only', { identity: 'bob' }),
      ])

      expect(alice).toBe(true)
      expect(bob).toBe(false)
      expect(client.identity).toBe(sharedBefore)
    })
  })

  describe('caching', () => {
    it('should use cached definitions within TTL', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([alwaysOn('feature-a')]),
      )

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        cache: true,
        cacheTtl: 60,
      })

      await client.init()
      await client.fetchDefinitions()

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should refresh when cache expires', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse([{ featureKey: 'feature-a', filters: [] }]),
        )
        .mockResolvedValueOnce(
          createMockResponse([alwaysOn('feature-a')]),
        )

      const client = new TogglyEdgeClient({ appKey: 'test-key' })

      await client.init()
      expect(client.isFeatureOnSync('feature-a')).toBe(false)

      await client.refresh()
      expect(client.isFeatureOnSync('feature-a')).toBe(true)
    })

    it('does not serve identity A results as identity B from boolean cache', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([targeting('vip-only', 'alice')]),
      )

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        cache: true,
        cacheTtl: 60,
      })
      await client.init()

      expect(client.isFeatureOnSync('vip-only', { identity: 'alice' })).toBe(
        true,
      )
      expect(client.isFeatureOnSync('vip-only', { identity: 'bob' })).toBe(
        false,
      )
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling', () => {
    it('should fall back to defaults on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new TogglyEdgeClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })

      await client.init()

      expect(client.isFeatureOnSync('feature-a')).toBe(true)
      expect(client.getState().error).toBeInstanceOf(Error)
    })
  })
})

describe('createEdgeClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should create an edge client', () => {
    const client = createEdgeClient({ appKey: 'test-key' })
    expect(client).toBeInstanceOf(TogglyEdgeClient)
  })
})

describe('Global edge client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetEdgeToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    resetEdgeToggly()
  })

  it('should initialize global client', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse([]))

    const client = await initEdgeToggly({ appKey: 'test-key' })

    expect(client).toBeInstanceOf(TogglyEdgeClient)
    expect(getEdgeToggly()).toBe(client)
  })

  it('should return null before initialization', () => {
    expect(getEdgeToggly()).toBeNull()
  })

  it('should reset global client', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse([]))

    await initEdgeToggly({ appKey: 'test-key' })
    expect(getEdgeToggly()).not.toBeNull()

    resetEdgeToggly()
    expect(getEdgeToggly()).toBeNull()
  })
})
