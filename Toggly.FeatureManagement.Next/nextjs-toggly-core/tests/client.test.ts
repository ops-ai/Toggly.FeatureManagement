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
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('should create a client with default config', () => {
      const client = createTogglyClient()

      expect(client.config.baseUri).toBe('https://definitions.toggly.io')
      expect(client.config.environment).toBe('Production')
      expect(client.state.initialized).toBe(false)
      expect(client.state.loading).toBe(false)
    })

    it('should merge custom config with defaults', () => {
      const client = createTogglyClient({
        appKey: 'test-key',
        environment: 'Development',
        featureDefaults: { 'feature-a': true },
      })

      expect(client.config.appKey).toBe('test-key')
      expect(client.config.environment).toBe('Development')
      expect(client.config.baseUri).toBe('https://definitions.toggly.io')
    })

    it('should initialize with feature defaults before API call', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-b', enabled: true }],
        })
      )

      const client = createTogglyClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })

      const features = await client.init()

      expect(features['feature-a']).toBe(true)
      expect(features['feature-b']).toBe(true)
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
    })

    it('should generate identity if not provided', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      expect(client.identity).toBeDefined()
      expect(typeof client.identity).toBe('string')
    })

    it('should use provided identity', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        identity: 'user-123',
      })
      await client.init()

      expect(client.identity).toBe('user-123')
    })
  })

  describe('feature evaluation', () => {
    it('should return true for enabled feature', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.isFeatureOn('feature-a')
      expect(result).toBe(true)
    })

    it('should return false for disabled feature', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.isFeatureOn('feature-a')
      expect(result).toBe(false)
    })

    it('should return false for unknown feature', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.isFeatureOn('unknown-feature')
      expect(result).toBe(false)
    })

    it('should return inverted result for isFeatureOff', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.isFeatureOff('feature-a')
      expect(result).toBe(false)
    })
  })

  describe('feature gate evaluation', () => {
    it('should evaluate all features with "all" requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: true },
          ],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'all'
      )
      expect(result).toBe(true)
    })

    it('should return false when not all features are enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'all'
      )
      expect(result).toBe(false)
    })

    it('should return true when any feature is enabled with "any" requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.evaluateFeatureGate(
        ['feature-a', 'feature-b'],
        'any'
      )
      expect(result).toBe(true)
    })

    it('should negate result when negate is true', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      const result = await client.evaluateFeatureGate(
        ['feature-a'],
        'all',
        true
      )
      expect(result).toBe(false)
    })
  })

  describe('identity management', () => {
    it('should set identity and refresh features', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      await client.setIdentity('new-user')

      expect(client.identity).toBe('new-user')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('refresh', () => {
    it('should refresh features from API', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: false }],
          })
        )
        .mockResolvedValueOnce(
          createMockResponse({
            features: [{ featureKey: 'feature-a', enabled: true }],
          })
        )

      const client = createTogglyClient({ appKey: 'test-key' })
      await client.init()

      expect(await client.isFeatureOn('feature-a')).toBe(false)

      await client.refresh()

      expect(await client.isFeatureOn('feature-a')).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should fall back to defaults on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = createTogglyClient({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      })

      const features = await client.init()

      expect(features['feature-a']).toBe(true)
      expect(client.state.error).toBeInstanceOf(Error)
      expect(client.state.initialized).toBe(true)
    })

    it('should warn when no appKey is provided', async () => {
      const client = createTogglyClient({
        featureDefaults: { 'feature-a': true },
      })

      await client.init()

      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly] No appKey provided, using defaults only'
      )
    })
  })

  describe('hooks', () => {
    it('should execute beforeEvaluation and afterEvaluation hooks', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const beforeEvaluation = vi.fn().mockResolvedValue({ startTime: Date.now() })
      const afterEvaluation = vi.fn()

      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
        beforeEvaluation,
        afterEvaluation,
      }

      const client = createTogglyClient({
        appKey: 'test-key',
        hooks: [hook],
      })

      await client.init()
      await client.isFeatureOn('feature-a')

      // Wait for async hooks
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(beforeEvaluation).toHaveBeenCalledWith('feature-a', undefined)
      expect(afterEvaluation).toHaveBeenCalledWith(
        'feature-a',
        expect.anything(),
        true
      )
    })

    it('should execute afterRefresh hooks', async () => {
      const afterRefresh = vi.fn()

      const hook: Hook = {
        getMetadata: () => ({ name: 'refresh-hook' }),
        afterRefresh,
      }

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      const client = createTogglyClient({
        appKey: 'test-key',
        hooks: [hook],
      })

      await client.init()

      expect(afterRefresh).toHaveBeenCalledWith({ 'feature-a': true })
    })

    it('should add and remove hooks dynamically', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ features: [] }))

      const client = createTogglyClient({ appKey: 'test-key' })

      const hook: Hook = {
        getMetadata: () => ({ name: 'dynamic-hook' }),
        beforeEvaluation: vi.fn(),
      }

      client.addHook(hook)
      await client.init()
      await client.isFeatureOn('feature-a')

      expect(hook.beforeEvaluation).toHaveBeenCalled()

      const removed = client.removeHook('dynamic-hook')
      expect(removed).toBe(true)
    })
  })

  describe('destroy', () => {
    it('should clean up resources on destroy', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 1000,
      })

      await client.init()
      client.destroy()

      // Should use defaults after destroy
      const result = await client.isFeatureOn('feature-a')
      expect(result).toBe(false)
    })

    it('should throw error on init after destroy', async () => {
      const client = createTogglyClient({ appKey: 'test-key' })
      client.destroy()

      await expect(client.init()).rejects.toThrow(
        '[Toggly] Client has been destroyed'
      )
    })
  })

  describe('WebSocket live updates', () => {
    it('refetches without If-None-Match after flags-updated (avoids stale 304)', async () => {
      vi.useFakeTimers()

      class FakeWs {
        static instances: FakeWs[] = []
        onopen: ((ev: Event) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null
        close = vi.fn()
        constructor(_url: string) {
          FakeWs.instances.push(this)
        }
      }
      FakeWs.instances = []

      const initHeaders = {
        get: (name: string) =>
          name === 'X-Definitions-Revision' || name === 'ETag'
            ? 'rev-old'
            : null,
      }
      mockFetch.mockResolvedValueOnce({
        ...createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        }),
        headers: initHeaders,
      })

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
        webSocketImpl: FakeWs as unknown as new (url: string) => unknown,
      })

      await client.init()
      expect(await client.isFeatureOn('feature-a')).toBe(false)

      const socket = FakeWs.instances[0]
      expect(socket).toBeDefined()
      socket.onopen?.(new Event('open'))
      expect(client.state.wsConnected).toBe(true)

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        }),
      )

      socket.onmessage?.({
        data: JSON.stringify({
          type: 'flags-updated',
          etag: 'rev-new',
        }),
      } as MessageEvent)

      await vi.advanceTimersByTimeAsync(400)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const refreshCall = mockFetch.mock.calls[1]
      const refreshHeaders = refreshCall?.[1]?.headers as
        | Record<string, string>
        | undefined
      expect(refreshHeaders?.['If-None-Match']).toBeUndefined()
      expect(String(refreshCall?.[0])).toContain('rev=rev-new')
      expect(await client.isFeatureOn('feature-a')).toBe(true)

      client.destroy()
      vi.useRealTimers()
    })

    it('retries definitions fetch when CDN still serves the previous revision', async () => {
      vi.useFakeTimers()

      class FakeWs {
        static instances: FakeWs[] = []
        onopen: ((ev: Event) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null
        close = vi.fn()
        constructor(_url: string) {
          FakeWs.instances.push(this)
        }
      }
      FakeWs.instances = []

      const headersFor = (revision: string) => ({
        get: (name: string) =>
          name === 'X-Definitions-Revision' || name === 'ETag'
            ? revision
            : null,
      })

      mockFetch.mockResolvedValueOnce({
        ...createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        }),
        headers: headersFor('rev-old'),
      })

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
        webSocketImpl: FakeWs as unknown as new (url: string) => unknown,
      })

      await client.init()
      FakeWs.instances[0]?.onopen?.(new Event('open'))

      // Debounced refresh still sees CDN lag (old revision header).
      mockFetch.mockResolvedValueOnce({
        ...createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        }),
        headers: headersFor('rev-old'),
      })

      FakeWs.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: 'flags-updated',
          etag: 'rev-new',
        }),
      } as MessageEvent)

      await vi.advanceTimersByTimeAsync(400)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(await client.isFeatureOn('feature-a')).toBe(false)

      // Retry at 800ms gets the new revision.
      mockFetch.mockResolvedValueOnce({
        ...createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        }),
        headers: headersFor('rev-new'),
      })

      await vi.advanceTimersByTimeAsync(500)
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(await client.isFeatureOn('feature-a')).toBe(true)

      // Later retry timers no-op once revision matches.
      await vi.advanceTimersByTimeAsync(4000)
      expect(mockFetch).toHaveBeenCalledTimes(3)

      client.destroy()
      vi.useRealTimers()
    })

    it('skips CDN revision retries when flags-updated has no etag', async () => {
      vi.useFakeTimers()

      class FakeWs {
        static instances: FakeWs[] = []
        onopen: ((ev: Event) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null
        close = vi.fn()
        constructor(_url: string) {
          FakeWs.instances.push(this)
        }
      }
      FakeWs.instances = []

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        }),
      )

      const client = createTogglyClient({
        appKey: 'test-key',
        refreshInterval: 0,
        enableLiveUpdates: true,
        webSocketImpl: FakeWs as unknown as new (url: string) => unknown,
      })

      await client.init()
      FakeWs.instances[0]?.onopen?.(new Event('open'))

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        }),
      )

      FakeWs.instances[0]?.onmessage?.({
        data: JSON.stringify({ type: 'flags-updated' }),
      } as MessageEvent)

      await vi.advanceTimersByTimeAsync(400)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      client.destroy()
      vi.useRealTimers()
    })
  })
})
