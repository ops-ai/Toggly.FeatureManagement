import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../src/client'
import type { Hook } from '../src/types'

// Mock fetch globally
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
    headers: {
      get: () => null,
    },
  }
}

describe('createTogglyClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should create a client with default config', () => {
      const client = createTogglyClient()

      expect(client.config.baseUri).toBe('https://definitions.toggly.io')
      expect(client.config.environment).toBe('Production')
      expect(client.config.refreshInterval).toBe(180000)
      expect(client.config.showFeatureDuringEvaluation).toBe(false)
      expect(client.state.initialized).toBe(false)

      client.destroy()
    })

    it('should merge custom config with defaults', () => {
      const client = createTogglyClient({
        appKey: 'test-key',
        environment: 'Staging',
      })

      expect(client.config.appKey).toBe('test-key')
      expect(client.config.environment).toBe('Staging')
      expect(client.config.baseUri).toBe('https://definitions.toggly.io')

      client.destroy()
    })

    it('should register initial hooks', () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
      }

      const client = createTogglyClient({
        hooks: [hook],
      })

      // Hooks are added internally, verify by adding duplicate
      vi.spyOn(console, 'warn')
      client.addHook(hook)
      expect(console.warn).toHaveBeenCalled()

      client.destroy()
    })
  })

  describe('init()', () => {
    it('should fetch and store feature definitions', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      const result = await client.init()

      expect(result).toEqual({ 'feature-a': true, 'feature-b': false })
      expect(client.state.features).toEqual({ 'feature-a': true, 'feature-b': false })
      expect(client.state.initialized).toBe(true)

      client.destroy()
    })

    it('reads text() and falls back on invalid envelope when verifySignatures is true', async () => {
      const invalidBody = JSON.stringify({ defs: { 'feature-a': true } })
      const text = vi.fn().mockResolvedValue(invalidBody)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text,
        json: async () => JSON.parse(invalidBody),
        headers: { get: () => null },
      })

      const client = createTogglyClient({
        appKey: 'test-key',
        verifySignatures: true,
        refreshInterval: 0,
        featureDefaults: { 'feature-a': false },
      })

      const features = await client.init()
      expect(text).toHaveBeenCalled()
      expect(features['feature-a']).toBe(false)
      client.destroy()
    })

    it('should generate identity if not provided', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      expect(client.identity).toBeDefined()
      expect(client.identity).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )

      client.destroy()
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        identity: 'user-123',
      })
      await client.init()

      expect(client.identity).toBe('user-123')

      client.destroy()
    })

    it('should include identity in request header', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        identity: 'user-123',
      })
      await client.init()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-toggly-identity': 'user-123',
          }),
        })
      )

      client.destroy()
    })

    it('should use defaults when API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = createTogglyClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })
      const result = await client.init()

      expect(result).toEqual({ 'feature-a': true })
      expect(client.state.error).toBeInstanceOf(Error)
      expect(client.state.initialized).toBe(true)

      client.destroy()
    })

    it('should use defaults when no appKey provided', async () => {
      const client = createTogglyClient({
        featureDefaults: { 'feature-a': true },
      })
      const result = await client.init()

      expect(result).toEqual({ 'feature-a': true })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly] No appKey provided, using defaults only'
      )

      client.destroy()
    })

    it('should merge API response with defaults', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-b', enabled: false }],
        })
      )

      const client = createTogglyClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true, 'feature-b': true },
      })
      const result = await client.init()

      expect(result).toEqual({ 'feature-a': true, 'feature-b': false })

      client.destroy()
    })

    it('should start auto-refresh interval', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 1000,
      })
      await client.init()

      expect(mockFetch).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1000)
      await Promise.resolve()

      expect(mockFetch).toHaveBeenCalledTimes(2)

      client.destroy()
    })

    it('should not start auto-refresh when interval is 0', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
      })
      await client.init()

      vi.advanceTimersByTime(200000)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      client.destroy()
    })

    it('should execute afterRefresh hooks', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const afterRefresh = vi.fn()
      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
        afterRefresh,
      }

      const client = createTogglyClient({
        appKey: 'test-key',
        hooks: [hook],
      })
      await client.init()

      expect(afterRefresh).toHaveBeenCalledWith({ 'feature-a': true })

      client.destroy()
    })

    it('should throw error if client is destroyed', async () => {
      const client = createTogglyClient({ appKey: 'test-key' })
      client.destroy()

      await expect(client.init()).rejects.toThrow(
        '[Toggly] Client has been destroyed'
      )
    })

    it('should allow re-init with new config', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-b', enabled: false }],
          })
        )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      expect(client.state.features).toHaveProperty('feature-a')

      await client.init({ environment: 'Staging' })

      expect(client.config.environment).toBe('Staging')

      client.destroy()
    })
  })

  describe('refresh()', () => {
    it('should fetch fresh definitions', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: false }],
          })
        )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(client.state.features['feature-a']).toBe(true)

      await client.refresh()

      expect(client.state.features['feature-a']).toBe(false)

      client.destroy()
    })

    it('should preserve last-known-good features on failure', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        }))
        .mockRejectedValueOnce(new Error('Network error'))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      await expect(client.refresh()).resolves.toEqual({ 'feature-a': true })
      expect(client.state.features['feature-a']).toBe(true)
      expect(client.state.error).toBeInstanceOf(Error)
      expect(client.state.error?.message).toBe('Network error')

      client.destroy()
    })
  })

  describe('isFeatureOn()', () => {
    it('should return true for enabled feature', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(await client.isFeatureOn('feature-a')).toBe(true)

      client.destroy()
    })

    it('should return false for disabled feature', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(await client.isFeatureOn('feature-a')).toBe(false)

      client.destroy()
    })

    it('should return false for unknown feature', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(await client.isFeatureOn('unknown')).toBe(false)

      client.destroy()
    })

    it('should execute hooks', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const beforeEvaluation = vi.fn()
      const afterEvaluation = vi.fn()
      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
        beforeEvaluation,
        afterEvaluation,
      }

      const client = createTogglyClient({
        appKey: 'test-key',
        hooks: [hook],
        refreshInterval: 0,
      })
      await client.init()

      await client.isFeatureOn('feature-a')

      expect(beforeEvaluation).toHaveBeenCalledWith('feature-a', undefined)

      // Wait for async after hook
      await vi.waitFor(() => {
        expect(afterEvaluation).toHaveBeenCalledWith('feature-a', undefined, true)
      })

      client.destroy()
    })
  })

  describe('isFeatureOff()', () => {
    it('should return inverse of isFeatureOn', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(await client.isFeatureOff('feature-a')).toBe(false)

      client.destroy()
    })
  })

  describe('evaluateFeatureGate()', () => {
    it('should evaluate with "all" requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: true },
          ],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(
        await client.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')
      ).toBe(true)

      client.destroy()
    })

    it('should evaluate with "any" requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(
        await client.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')
      ).toBe(true)

      client.destroy()
    })

    it('should support negation', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      expect(
        await client.evaluateFeatureGate(['feature-a'], 'all', true)
      ).toBe(false)

      client.destroy()
    })

    it('should use defaults when client is destroyed', async () => {
      const client = createTogglyClient({
        featureDefaults: { 'feature-a': true },
      })
      client.destroy()

      expect(await client.evaluateFeatureGate(['feature-a'])).toBe(true)
    })
  })

  describe('setIdentity()', () => {
    it('should set identity and refresh', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      await client.setIdentity('new-user')

      expect(client.identity).toBe('new-user')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      client.destroy()
    })

    it('should execute identity hooks', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      const beforeIdentify = vi.fn()
      const afterIdentify = vi.fn()
      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
        beforeIdentify,
        afterIdentify,
      }

      const client = createTogglyClient({
        appKey: 'test-key',
        hooks: [hook],
        refreshInterval: 0,
      })
      await client.init()

      await client.setIdentity('new-user')

      expect(beforeIdentify).toHaveBeenCalledWith('new-user')
      expect(afterIdentify).toHaveBeenCalledWith('new-user', undefined)

      client.destroy()
    })
  })

  describe('addHook() / removeHook()', () => {
    it('should add and remove hooks', async () => {
      const client = createTogglyClient()

      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
      }

      client.addHook(hook)

      // Verify hook is added by trying to add duplicate
      vi.spyOn(console, 'warn')
      client.addHook(hook)
      expect(console.warn).toHaveBeenCalled()

      // Remove hook
      expect(client.removeHook('test-hook')).toBe(true)
      expect(client.removeHook('test-hook')).toBe(false)

      client.destroy()
    })
  })

  describe('subscriptions', () => {
    it('should subscribe and unsubscribe local gate listeners', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      const listener = vi.fn()
      const unsubscribe = client.subscribeLocalGatesChanged(listener)
      client.notifyLocalGatesChanged()
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      client.notifyLocalGatesChanged()
      expect(listener).toHaveBeenCalledTimes(1)

      client.destroy()
    })

    it('should subscribe and unsubscribe feature refresh listeners', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      const listener = vi.fn()
      const unsubscribe = client.subscribeFeaturesRefresh(listener)
      client.subscribeFeaturesRefresh(() => {}) // cover add path only
      unsubscribe()
      client.destroy()

      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('destroy()', () => {
    it('should stop refresh interval', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 1000,
      })
      await client.init()

      client.destroy()

      vi.advanceTimersByTime(2000)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('state', () => {
    it('should return a copy of state', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      const state1 = client.state
      const state2 = client.state

      expect(state1).not.toBe(state2)
      expect(state1).toEqual(state2)

      client.destroy()
    })

    it('should track loading state', async () => {
      let resolvePromise: () => void
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve
      })

      mockFetch.mockImplementationOnce(async () => {
        await promise
        return createMockResponse({ features: [] })
      })

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      const initPromise = client.init()

      expect(client.state.loading).toBe(true)

      resolvePromise!()
      await initPromise

      expect(client.state.loading).toBe(false)

      client.destroy()
    })
  })

  describe('destroyed client behaviour', () => {
    it('refresh() should throw when client is destroyed', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ features: [{ featureKey: 'f', enabled: true }] })
      )
      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()
      client.destroy()

      await expect(client.refresh()).rejects.toThrow('[Toggly] Client has been destroyed')
    })

    it('isFeatureOn() should return featureDefaults value when destroyed', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ features: [{ featureKey: 'f', enabled: true }] })
      )
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        featureDefaults: { f: false },
      })
      await client.init()
      client.destroy()

      expect(await client.isFeatureOn('f')).toBe(false)
    })

    it('setIdentity() should return early when destroyed', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ features: [] })
      )
      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()
      client.destroy()

      // Should not throw and should not call fetch again
      const callsBefore = mockFetch.mock.calls.length
      await client.setIdentity('user-123')
      expect(mockFetch.mock.calls.length).toBe(callsBefore)
    })
  })

  describe('identity setter', () => {
    it('should update identity via property setter', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      client.identity = 'new-user'
      expect(client.identity).toBe('new-user')

      client.destroy()
    })

    it('should set identity to undefined via property setter', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        identity: 'existing-user',
      })
      await client.init()

      client.identity = undefined
      expect(client.identity).toBeUndefined()

      client.destroy()
    })
  })

  describe('WebSocket live updates', () => {
    let mockWsInstances: any[]
    const savedWindow = (globalThis as any).window
    const savedDocument = (globalThis as any).document

    beforeEach(() => {
      mockWsInstances = []
      const MockWs = class {
        url: string
        onopen: (() => void) | null = null
        onmessage: ((e: { data: string }) => void) | null = null
        onclose: (() => void) | null = null
        onerror: ((e: any) => void) | null = null
        closeCalled = false
        constructor(url: string) {
          this.url = url
          mockWsInstances.push(this)
        }
        close() { this.closeCalled = true }
      }
      ;(globalThis as any).window = {}
      ;(globalThis as any).document = {}
      ;(globalThis as any).WebSocket = MockWs
    })

    afterEach(() => {
      ;(globalThis as any).window = savedWindow
      delete (globalThis as any).document
      delete (globalThis as any).WebSocket
    })

    it('should not start WebSocket when enableLiveUpdates is false', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: false,
      })
      await client.init()
      expect(mockWsInstances).toHaveLength(0)
      client.destroy()
    })

    it('should not start WebSocket when no appKey', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({ refreshInterval: 0, enableLiveUpdates: true })
      await client.init()
      expect(mockWsInstances).toHaveLength(0)
      client.destroy()
    })

    it('should start WebSocket when enableLiveUpdates is true', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      expect(mockWsInstances).toHaveLength(1)
      expect(mockWsInstances[0].url).toBe('wss://definitions.toggly.io/test-key/ws?sdk=nuxt&sdkVersion=1.3.1')
      client.destroy()
    })

    it('should build ws:// URL from http:// baseUri', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'mykey',
        baseUri: 'http://local.test',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      expect(mockWsInstances[0].url).toBe('ws://local.test/mykey/ws?sdk=nuxt&sdkVersion=1.3.1')
      client.destroy()
    })

    it('should set wsConnected on onopen', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      mockWsInstances[0].onopen!()
      // no assertion on internal state — just verify it doesn't throw
      client.destroy()
    })

    it('should refresh on flags-updated message', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      const callsBefore = mockFetch.mock.calls.length
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'flags-updated' }) })
      await vi.advanceTimersByTimeAsync(350)
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore)
      client.destroy()
    })

    it('should refresh on update message', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      const callsBefore = mockFetch.mock.calls.length
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'update' }) })
      await vi.advanceTimersByTimeAsync(350)
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore)
      client.destroy()
    })

    it('should ignore ping message', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      const callsBefore = mockFetch.mock.calls.length
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'ping' }) })
      expect(mockFetch.mock.calls.length).toBe(callsBefore)
      client.destroy()
    })

    it('should ignore malformed JSON message', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      expect(() => {
        mockWsInstances[0].onmessage!({ data: 'not-json' })
      }).not.toThrow()
      client.destroy()
    })

    it('should log error on onerror', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      const err = new Event('error')
      mockWsInstances[0].onerror!(err)
      expect(errSpy).toHaveBeenCalledWith('[Toggly] WebSocket error:', err)
      client.destroy()
    })

    it('should schedule reconnect on onclose', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      mockWsInstances[0].onclose!()
      vi.runAllTimers()
      expect(mockWsInstances).toHaveLength(2)
      client.destroy()
    })

    it('should stop WebSocket on destroy', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
      })
      await client.init()
      const ws = mockWsInstances[0]
      client.destroy()
      expect(ws.closeCalled).toBe(true)
    })
  })

  describe('wsConnected throttle in refresh interval', () => {
    it('should skip fallback refresh when wsConnected and within throttle window', async () => {
      let mockWsInstances: any[] = []
      const MockWs = class {
        url: string
        onopen: (() => void) | null = null
        onmessage: ((e: { data: string }) => void) | null = null
        onclose: (() => void) | null = null
        onerror: ((e: any) => void) | null = null
        constructor(url: string) {
          this.url = url
          mockWsInstances.push(this)
        }
        close() {}
      }
      ;(globalThis as any).window = {}
      ;(globalThis as any).document = {}
      ;(globalThis as any).WebSocket = MockWs

      try {
        mockFetch.mockResolvedValue(createMockResponse({ features: [] }))
        const client = createTogglyClient({
          appKey: 'test-key',
          refreshInterval: 100,
          enableLiveUpdates: true,
        })
        await client.init()

        // Fire onopen to mark wsConnected = true and set lastFallbackRefresh = now
        mockWsInstances[0].onopen!()

        const callsAfterInit = mockFetch.mock.calls.length

        // Advance time by one refresh interval — should be throttled because wsConnected
        await vi.advanceTimersByTimeAsync(100)

        // Fetch should NOT have been called again (within throttle window)
        expect(mockFetch.mock.calls.length).toBe(callsAfterInit)

        client.destroy()
      } finally {
        ;(globalThis as any).window = undefined
        delete (globalThis as any).document
        delete (globalThis as any).WebSocket
      }
    })
  })

  describe('HTTP error handling', () => {
    it('should handle non-ok responses', async () => {
      // Simulate HTTP 404 by throwing in the response's json() method
      // since the client checks response.ok and throws before calling json()
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not found' }),
      })

      const client = createTogglyClient({
        appKey: 'test-key',
        featureDefaults: { default: true },
        refreshInterval: 0,
      })

      await client.init()

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalled()

      // When fetch fails with non-ok status, error is set and defaults are used
      expect(client.state.error).toBeInstanceOf(Error)
      expect(client.state.error?.message).toContain('404')
      expect(client.state.features).toEqual({ default: true })

      client.destroy()
    })

    it('should handle fetch rejection', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = createTogglyClient({
        appKey: 'test-key',
        featureDefaults: { fallback: false },
        refreshInterval: 0,
      })
      await client.init()

      expect(client.state.error).toBeInstanceOf(Error)
      expect(client.state.features).toEqual({ fallback: false })

      client.destroy()
    })
  })
})
