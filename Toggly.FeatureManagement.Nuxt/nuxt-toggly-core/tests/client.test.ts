import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../src/client'
import type { Hook } from '../src/types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
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

      expect(client.config.baseUri).toBe('https://client.toggly.io')
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
      expect(client.config.baseUri).toBe('https://client.toggly.io')

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

    it('should throw error on failure', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ features: [] }))
        .mockRejectedValueOnce(new Error('Network error'))

      const client = createTogglyClient({ appKey: 'test-key', refreshInterval: 0 })
      await client.init()

      await expect(client.refresh()).rejects.toThrow()

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
