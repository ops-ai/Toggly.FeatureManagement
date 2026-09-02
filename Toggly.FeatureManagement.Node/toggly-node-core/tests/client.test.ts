import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createTogglyClient,
  initToggly,
  getToggly,
  useToggly,
  closeToggly,
} from '../src/client'
import type { TogglyServerConfig, Hook } from '../src/types'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function def(
  featureKey: string,
  filters: FeatureDefinitionModel['filters'] = [{ name: 'AlwaysOn', parameters: {} }],
): FeatureDefinitionModel {
  return { featureKey, filters }
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

describe('createTogglyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly() // Reset singleton
  })

  afterEach(() => {
    closeToggly()
  })

  describe('initialization', () => {
    it('should create a client with default config', () => {
      const client = createTogglyClient()

      expect(client.config.environment).toBe('Production')
      expect(client.config.baseUrl).toBe('https://definitions.toggly.io')
      expect(client.config.refreshInterval).toBe(180000)
      expect(client.state.initialized).toBe(false)
    })

    it('should merge custom config with defaults', () => {
      const client = createTogglyClient({
        appKey: 'test-app-key',
        environment: 'Development',
        debug: true,
      })

      expect(client.config.appKey).toBe('test-app-key')
      expect(client.config.environment).toBe('Development')
      expect(client.config.debug).toBe(true)
      expect(client.config.baseUrl).toBe('https://definitions.toggly.io') // Default preserved
    })

    it('should use feature defaults when no appKey provided', async () => {
      const client = createTogglyClient({
        featureDefaults: {
          'feature-a': true,
          'feature-b': false,
        },
      })

      await client.init()

      expect(await client.isFeatureOn('feature-a')).toBe(true)
      expect(await client.isFeatureOn('feature-b')).toBe(false)
      expect(client.state.initialized).toBe(true)
    })
  })

  describe('init', () => {
    it('should fetch definitions on init', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"abc123"' }),
        text: async () =>
          JSON.stringify([
            def('feature-a'),
            def('feature-b', [{ name: 'AlwaysOff', parameters: {} }]),
          ]),
        json: async () => [
          def('feature-a'),
          def('feature-b', [{ name: 'AlwaysOff', parameters: {} }]),
        ],
      })

      const client = createTogglyClient({
        appKey: 'test-app',
        environment: 'Production',
      })

      const features = await client.init()

      expect(features).toEqual({
        'feature-a': true,
        'feature-b': false,
      })
      expect(client.state.initialized).toBe(true)
      expect(client.state.definitions.size).toBe(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should generate identity if not provided', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      const client = createTogglyClient({ appKey: 'test-app' })
      await client.init()

      expect(client.identity).toBeDefined()
      expect(client.identity).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
      const url = String(mockFetch.mock.calls[0][0])
      expect(url).not.toContain('?u=')
      expect(url).not.toContain(client.identity!)
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      const client = createTogglyClient({
        appKey: 'test-app',
        identity: 'custom-identity',
      })
      await client.init()

      expect(client.identity).toBe('custom-identity')
    })

    it('should merge feature defaults with API response', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([def('api-feature')]))

      const client = createTogglyClient({
        appKey: 'test-app',
        featureDefaults: {
          'default-feature': true,
          'api-feature': false, // Will be overridden by snapshot from definitions
        },
      })

      await client.init()

      expect(await client.isFeatureOn('default-feature')).toBe(true)
      expect(await client.isFeatureOn('api-feature')).toBe(true) // API value
    })

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = createTogglyClient({
        appKey: 'test-app',
        featureDefaults: { 'fallback-feature': true },
      })

      const features = await client.init()

      expect(features).toEqual({ 'fallback-feature': true })
      expect(client.state.initialized).toBe(true)
      expect(client.state.error).not.toBeNull()
    })
  })

  describe('isFeatureOn/isFeatureOff', () => {
    let client: ReturnType<typeof createTogglyClient>

    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(
        defsResponse([
          def('enabled-feature'),
          def('disabled-feature', [{ name: 'AlwaysOff', parameters: {} }]),
        ]),
      )

      client = createTogglyClient({ appKey: 'test-app' })
      await client.init()
    })

    it('should return true for enabled feature', async () => {
      expect(await client.isFeatureOn('enabled-feature')).toBe(true)
    })

    it('should return false for disabled feature', async () => {
      expect(await client.isFeatureOn('disabled-feature')).toBe(false)
    })

    it('should return false for unknown feature', async () => {
      expect(await client.isFeatureOn('unknown-feature')).toBe(false)
    })

    it('isFeatureOff should be inverse of isFeatureOn', async () => {
      expect(await client.isFeatureOff('enabled-feature')).toBe(false)
      expect(await client.isFeatureOff('disabled-feature')).toBe(true)
    })
  })

  describe('local targeting evaluation', () => {
    it('evaluates Targeting with call-site identity without re-fetch', async () => {
      mockFetch.mockResolvedValueOnce(
        defsResponse([
          {
            featureKey: 'beta',
            filters: [
              {
                name: 'Targeting',
                parameters: {
                  'Audience.Users:0': 'alice',
                  'Audience.DefaultRolloutPercentage': 0,
                },
              },
            ],
          },
        ]),
      )

      const client = createTogglyClient({
        appKey: 'test-app',
        identity: 'bob',
      })
      await client.init()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      expect(await client.isFeatureOn('beta')).toBe(false)
      expect(await client.isFeatureOn('beta', { identity: 'alice' })).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('evaluates Percentage and ContextProperty filters locally', async () => {
      mockFetch.mockResolvedValueOnce(
        defsResponse([
          {
            featureKey: 'pct',
            filters: [{ name: 'Percentage', parameters: { Value: 100 } }],
          },
          {
            featureKey: 'orders',
            requirementType: 'Any',
            contextRequirementType: 'All',
            filters: [
              {
                name: 'ContextProperty',
                parameters: {
                  Property: 'Color',
                  Operator: 'eq',
                  Value: 'red',
                  ValueType: 'string',
                },
              },
              { name: 'AlwaysOn', parameters: {} },
            ],
          },
        ]),
      )

      const client = createTogglyClient({
        appKey: 'test-app',
        identity: 'user-1',
      })
      await client.init()

      expect(await client.isFeatureOn('pct')).toBe(true)
      expect(await client.isFeatureOn('orders')).toBe(false)
      expect(
        await client.isFeatureOn('orders', undefined, {
          kind: 'Order',
          key: '1',
          attributes: { Color: 'red' },
        }),
      ).toBe(true)
    })
  })

  describe('evaluateFeatureGate', () => {
    let client: ReturnType<typeof createTogglyClient>

    beforeEach(async () => {
      mockFetch.mockResolvedValueOnce(
        defsResponse([
          def('feature-a'),
          def('feature-b', [{ name: 'AlwaysOff', parameters: {} }]),
          def('feature-c'),
        ]),
      )

      client = createTogglyClient({ appKey: 'test-app' })
      await client.init()
    })

    it('should evaluate all requirement', async () => {
      expect(
        await client.evaluateFeatureGate(['feature-a', 'feature-c'], 'all')
      ).toBe(true)
      expect(
        await client.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')
      ).toBe(false)
    })

    it('should evaluate any requirement', async () => {
      expect(
        await client.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')
      ).toBe(true)
      expect(
        await client.evaluateFeatureGate(['feature-b'], 'any')
      ).toBe(false)
    })

    it('should support negation', async () => {
      expect(
        await client.evaluateFeatureGate(['feature-a'], 'all', true)
      ).toBe(false)
      expect(
        await client.evaluateFeatureGate(['feature-b'], 'all', true)
      ).toBe(true)
    })
  })

  describe('refresh', () => {
    it('should fetch fresh definitions', async () => {
      // Initial fetch
      mockFetch.mockResolvedValueOnce(
        defsResponse([def('feature', [{ name: 'AlwaysOff', parameters: {} }])]),
      )

      const client = createTogglyClient({ appKey: 'test-app' })
      await client.init()

      expect(await client.isFeatureOn('feature')).toBe(false)

      // Refresh with new data
      mockFetch.mockResolvedValueOnce(defsResponse([def('feature')]))

      await client.refresh()

      expect(await client.isFeatureOn('feature')).toBe(true)
    })

    it('should handle 304 Not Modified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"v1"' }),
        text: async () => JSON.stringify([def('feature')]),
        json: async () => [def('feature')],
      })

      const client = createTogglyClient({ appKey: 'test-app' })
      await client.init()

      // 304 response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 304,
        headers: new Map(),
      })

      const features = await client.refresh()

      expect(features).toEqual({ 'feature': true })
    })
  })

  describe('setIdentity', () => {
    it('should update identity without refreshing', async () => {
      mockFetch.mockResolvedValue(defsResponse([]))

      const client = createTogglyClient({ appKey: 'test-app' })
      await client.init()

      await client.setIdentity('new-identity')

      expect(client.identity).toBe('new-identity')
      // Identity is eval-time only — no refresh after setIdentity
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('hooks', () => {
    it('should register and execute hooks', async () => {
      const beforeEval = vi.fn().mockResolvedValue({ data: 'test' })
      const afterEval = vi.fn()

      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
        beforeEvaluation: beforeEval,
        afterEvaluation: afterEval,
      }

      mockFetch.mockResolvedValueOnce(defsResponse([def('feature')]))

      const client = createTogglyClient({
        appKey: 'test-app',
        hooks: [hook],
      })
      await client.init()

      await client.isFeatureOn('feature')

      expect(beforeEval).toHaveBeenCalledWith(
        'feature',
        expect.any(Object),
        undefined
      )
      expect(afterEval).toHaveBeenCalledWith(
        'feature',
        expect.any(Object),
        { data: 'test' },
        true
      )
    })

    it('should add hooks dynamically', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      const client = createTogglyClient({ appKey: 'test-app' })
      await client.init()

      const afterRefresh = vi.fn()
      client.addHook({
        getMetadata: () => ({ name: 'dynamic-hook' }),
        afterRefresh,
      })

      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await client.refresh()

      expect(afterRefresh).toHaveBeenCalled()
    })

    it('should remove hooks', async () => {
      const afterRefresh = vi.fn()

      mockFetch.mockResolvedValueOnce(defsResponse([]))

      const client = createTogglyClient({
        appKey: 'test-app',
        hooks: [{
          getMetadata: () => ({ name: 'removable-hook' }),
          afterRefresh,
        }],
      })
      await client.init()

      const removed = client.removeHook('removable-hook')
      expect(removed).toBe(true)

      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await client.refresh()

      // Hook should not be called after removal
      expect(afterRefresh).toHaveBeenCalledTimes(1) // Only from init
    })
  })

  describe('close', () => {
    it('should cleanup resources', async () => {
      vi.useFakeTimers()

      mockFetch.mockResolvedValue(defsResponse([]))

      const client = createTogglyClient({
        appKey: 'test-app',
        refreshInterval: 1000,
      })
      await client.init()

      client.close()

      // Advance time past refresh interval
      vi.advanceTimersByTime(5000)

      // Fetch should only have been called once (init)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })
  })
})

describe('singleton functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(() => {
    closeToggly()
  })

  describe('initToggly', () => {
    it('should initialize and return the default client', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      const client = await initToggly({ appKey: 'test-app' })

      expect(client).toBeDefined()
      expect(client.state.initialized).toBe(true)
    })

    it('should replace existing client on re-initialization', async () => {
      mockFetch.mockResolvedValue(defsResponse([]))

      const client1 = await initToggly({ appKey: 'app-1' })
      const client2 = await initToggly({ appKey: 'app-2' })

      expect(client1).not.toBe(client2)
      expect(getToggly()).toBe(client2)
    })
  })

  describe('getToggly', () => {
    it('should return null before initialization', () => {
      expect(getToggly()).toBeNull()
    })

    it('should return client after initialization', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await initToggly({ appKey: 'test-app' })

      expect(getToggly()).not.toBeNull()
    })
  })

  describe('useToggly', () => {
    it('should throw if not initialized', () => {
      expect(() => useToggly()).toThrow('Toggly client not initialized')
    })

    it('should return client after initialization', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await initToggly({ appKey: 'test-app' })

      expect(() => useToggly()).not.toThrow()
      expect(useToggly().state.initialized).toBe(true)
    })
  })

  describe('closeToggly', () => {
    it('should close and clear the default client', async () => {
      mockFetch.mockResolvedValueOnce(defsResponse([]))

      await initToggly({ appKey: 'test-app' })
      expect(getToggly()).not.toBeNull()

      closeToggly()

      expect(getToggly()).toBeNull()
    })

    it('should be safe to call multiple times', () => {
      expect(() => {
        closeToggly()
        closeToggly()
        closeToggly()
      }).not.toThrow()
    })
  })
})

describe('API request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(() => {
    closeToggly()
  })

  it('should construct definitions-signed URL without identity query', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([]))

    const client = createTogglyClient({
      appKey: 'my-app',
      environment: 'Staging',
      identity: 'user-123',
    })
    await client.init()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://definitions.toggly.io/definitions-signed/my-app/Staging',
      expect.any(Object)
    )
  })

  it('should include ETag in subsequent requests', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"abc123"' }),
      text: async () => '[]',
      json: async () => [],
    })

    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 304,
      headers: new Map(),
    })

    await client.refresh()

    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'If-None-Match': 'abc123',
        }),
      })
    )
  })

  it('should handle HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Map(),
    })

    const client = createTogglyClient({
      appKey: 'test-app',
      featureDefaults: { fallback: true },
    })
    await client.init()

    expect(client.state.error).not.toBeNull()
    expect(await client.isFeatureOn('fallback')).toBe(true)
  })

  it('should handle timeout', async () => {
    // Mock AbortController to trigger immediately
    const abortError = new Error('AbortError')
    abortError.name = 'AbortError'
    mockFetch.mockRejectedValueOnce(abortError)

    const client = createTogglyClient({
      appKey: 'test-app',
      timeout: 100,
      featureDefaults: { fallback: true },
    })

    await client.init()

    expect(client.state.error).not.toBeNull()
    expect(await client.isFeatureOn('fallback')).toBe(true)
  })

  it('rejects empty signature when verifySignatures is enabled', async () => {
    // Empty signature must not bypass verification and apply unsigned defs.
    const body =
      '{"defs":[{"featureKey":"evil","filters":[{"name":"AlwaysOn","parameters":{}}]}],"signature":"","timestamp":1,"kid":"some-kid"}'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => body,
      json: async () => JSON.parse(body),
    })

    const client = createTogglyClient({
      appKey: 'test-app',
      verifySignatures: true,
      featureDefaults: { fallback: true },
    })
    await client.init()

    expect(await client.isFeatureOn('evil')).toBe(false)
    expect(await client.isFeatureOn('fallback')).toBe(true)
    expect(client.state.error).not.toBeNull()
  })
})

describe('clearCache and reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(() => {
    closeToggly()
  })

  it('should clear in-memory features and etag via clearCache', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"rev-1"' }),
      text: async () => JSON.stringify([def('feature-a')]),
      json: async () => [def('feature-a')],
    })

    const client = createTogglyClient({ appKey: 'test-app' })
    await client.init()
    expect(await client.isFeatureOn('feature-a')).toBe(true)
    expect(client.state.etag).toBe('rev-1')

    await client.clearCache()

    expect(await client.isFeatureOn('feature-a')).toBe(false)
    expect(client.state.etag).toBeNull()
    expect(client.state.definitions.size).toBe(0)
  })

  it('should preserve last-known-good features and call onError on refresh failure', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([def('feature-a')]))

    const onError = vi.fn()
    const client = createTogglyClient({
      appKey: 'test-app',
      onError,
    })
    await client.init()
    expect(await client.isFeatureOn('feature-a')).toBe(true)

    mockFetch.mockRejectedValueOnce(new Error('network down'))
    const features = await client.refresh()

    expect(features['feature-a']).toBe(true)
    expect(await client.isFeatureOn('feature-a')).toBe(true)
    expect(client.state.error).not.toBeNull()
    expect(onError).toHaveBeenCalled()
  })
})
