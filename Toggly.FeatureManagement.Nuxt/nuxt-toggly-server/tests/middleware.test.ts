import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  defineFeatureMiddleware,
  defineFeatureHandler,
  useEventToggly,
  isEventFeatureOn,
  isEventFeatureOff,
  evaluateEventFeatureGate,
} from '../src/middleware'
import {
  initServerToggly,
  resetServerToggly,
  getServerToggly,
} from '../src/server-client'
import type { H3Event } from 'h3'

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

function createMockEvent(headers: Record<string, string> = {}): H3Event {
  return {
    node: {
      req: {
        headers,
      },
    },
  } as unknown as H3Event
}

// Mock h3 functions
vi.mock('h3', () => ({
  createError: (options: { statusCode: number; message: string; statusMessage: string }) => {
    const error = new Error(options.message) as Error & { statusCode: number; statusMessage: string }
    error.statusCode = options.statusCode
    error.statusMessage = options.statusMessage
    return error
  },
  defineEventHandler: (handler: (event: H3Event) => unknown) => handler,
  getHeader: (event: H3Event, header: string) => {
    const headers = (event.node?.req?.headers || {}) as Record<string, string>
    return headers[header.toLowerCase()]
  },
  setResponseStatus: vi.fn(),
}))

describe('Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
  })

  describe('defineFeatureMiddleware', () => {
    it('should allow access when feature is enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const middleware = defineFeatureMiddleware({
        featureKey: 'feature-a',
      })

      const event = createMockEvent()

      // Should not throw
      await expect(middleware(event)).resolves.not.toThrow()
    })

    it('should throw error when feature is disabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const middleware = defineFeatureMiddleware({
        featureKey: 'feature-a',
        statusCode: 403,
        message: 'Feature disabled',
      })

      const event = createMockEvent()

      await expect(middleware(event)).rejects.toMatchObject({
        statusCode: 403,
        message: 'Feature disabled',
      })
    })

    it('should use custom onDisabled handler', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const onDisabled = vi.fn()

      const middleware = defineFeatureMiddleware({
        featureKey: 'feature-a',
        onDisabled,
      })

      const event = createMockEvent()

      try {
        await middleware(event)
      } catch {
        // Expected to throw
      }

      expect(onDisabled).toHaveBeenCalled()
    })

    it('should support multiple feature keys', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: true },
          ],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const middleware = defineFeatureMiddleware({
        featureKey: ['feature-a', 'feature-b'],
        requirement: 'all',
      })

      const event = createMockEvent()

      await expect(middleware(event)).resolves.not.toThrow()
    })

    it('should support "any" requirement', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: false },
          ],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const middleware = defineFeatureMiddleware({
        featureKey: ['feature-a', 'feature-b'],
        requirement: 'any',
      })

      const event = createMockEvent()

      await expect(middleware(event)).resolves.not.toThrow()
    })

    it('should use identity from header', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const middleware = defineFeatureMiddleware({
        featureKey: 'feature-a',
      })

      const event = createMockEvent({
        'x-toggly-identity': 'user-123',
      })

      await middleware(event)

      expect(getServerToggly()?.identity).toBe('user-123')
    })

    it('should warn and reject if client not initialized', async () => {
      const middleware = defineFeatureMiddleware({
        featureKey: 'feature-a',
      })

      const event = createMockEvent()

      await expect(middleware(event)).rejects.toMatchObject({
        statusCode: 503,
      })
      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly] Server client not initialized in middleware'
      )
    })
  })

  describe('defineFeatureHandler', () => {
    it('should call handler when feature is enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const handler = vi.fn().mockResolvedValue({ success: true })

      const wrappedHandler = defineFeatureHandler('feature-a', handler)

      const event = createMockEvent()
      const result = await wrappedHandler(event)

      expect(handler).toHaveBeenCalledWith(event)
      expect(result).toEqual({ success: true })
    })

    it('should throw error when feature is disabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const handler = vi.fn()

      const wrappedHandler = defineFeatureHandler('feature-a', handler)

      const event = createMockEvent()

      await expect(wrappedHandler(event)).rejects.toMatchObject({
        statusCode: 404,
      })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should reject and not call handler if client not initialized', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const wrappedHandler = defineFeatureHandler('feature-a', handler)

      const event = createMockEvent()

      await expect(wrappedHandler(event)).rejects.toMatchObject({
        statusCode: 503,
      })
      expect(handler).not.toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly] Server client not initialized in handler'
      )
    })
  })

  describe('useEventToggly', () => {
    it('should return client with identity from header', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent({
        'x-toggly-identity': 'user-123',
      })

      const client = useEventToggly(event)

      expect(client.identity).toBe('user-123')
    })

    it('should throw if client not initialized', () => {
      const event = createMockEvent()

      expect(() => useEventToggly(event)).toThrow(
        '[Toggly] Server client not initialized'
      )
    })
  })

  describe('isEventFeatureOn', () => {
    it('should check feature for event', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(await isEventFeatureOn(event, 'feature-a')).toBe(true)
    })

    it('should use identity from header', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent({
        'x-toggly-identity': 'user-123',
      })

      await isEventFeatureOn(event, 'feature-a')

      expect(getServerToggly()?.identity).toBe('user-123')
    })

    it('should return false if client not initialized', async () => {
      const event = createMockEvent()

      expect(await isEventFeatureOn(event, 'feature-a')).toBe(false)
      expect(console.warn).toHaveBeenCalled()
    })
  })

  describe('isEventFeatureOff', () => {
    it('should return inverse of isEventFeatureOn', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(await isEventFeatureOff(event, 'feature-a')).toBe(false)
    })
  })

  describe('evaluateEventFeatureGate', () => {
    it('should evaluate multiple features', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [
            { featureKey: 'feature-a', enabled: true },
            { featureKey: 'feature-b', enabled: true },
          ],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(
        await evaluateEventFeatureGate(event, ['feature-a', 'feature-b'], 'all')
      ).toBe(true)
    })

    it('should support negate option', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(
        await evaluateEventFeatureGate(event, ['feature-a'], 'all', true)
      ).toBe(false)
    })

    it('should return false if client not initialized', async () => {
      const event = createMockEvent()

      expect(
        await evaluateEventFeatureGate(event, ['feature-a'])
      ).toBe(false)
    })
  })
})
