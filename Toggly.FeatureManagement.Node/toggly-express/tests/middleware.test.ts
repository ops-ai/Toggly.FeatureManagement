import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import {
  togglyMiddleware,
  featureGate,
  featureRoutes,
  withFeature,
  featuresHandler,
  getExpressToggly,
  closeExpressToggly,
} from '../src/middleware'
import type { TogglyRequest } from '../src/types'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    path: '/',
    method: 'GET',
    ip: '127.0.0.1',
    ...overrides,
  } as Request
}

// Helper to create mock response
function createMockResponse(): Response & { _status: number; _json: unknown; _redirectUrl: string } {
  const res = {
    _status: 200,
    _json: null,
    _redirectUrl: '',
    status(code: number) {
      this._status = code
      return this
    },
    json(data: unknown) {
      this._json = data
      return this
    },
    redirect(statusOrUrl: number | string, url?: string) {
      if (typeof statusOrUrl === 'number') {
        this._status = statusOrUrl
        this._redirectUrl = url!
      } else {
        this._status = 302
        this._redirectUrl = statusOrUrl
      }
      return this
    },
  }
  return res as Response & { _status: number; _json: unknown; _redirectUrl: string }
}

describe('togglyMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeExpressToggly()

    // Default mock response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

          { featureKey: 'feature-a', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'feature-b', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
      text: async () => JSON.stringify([

          { featureKey: 'feature-a', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'feature-b', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
    })
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('should initialize client and attach toggly to request', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as TogglyRequest).toggly).toBeDefined()
    expect((req as TogglyRequest).toggly?.features).toEqual({
      'feature-a': true,
      'feature-b': false,
    })
  })

  it('should extract identity from header', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest({
      headers: { 'x-toggly-identity': 'user-123' },
    })
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect((req as TogglyRequest).toggly?.identity).toBe('user-123')
  })

  it('should use custom identity extractor', async () => {
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      getIdentity: (req) => {
        const authHeader = req.headers.authorization
        return typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : undefined
      },
    })
    const req = createMockRequest({
      headers: { authorization: 'Bearer custom-identity' },
    })
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect((req as TogglyRequest).toggly?.identity).toBe('custom-identity')
  })

  it('should use custom context extractor', async () => {
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      getContext: () => ({
        identity: 'context-identity',
        groups: ['admin'],
        traits: { custom: 'value' },
      }),
    })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const context = (req as TogglyRequest).toggly?.context
    expect(context?.identity).toBe('context-identity')
    expect(context?.groups).toEqual(['admin'])
    expect(context?.traits).toEqual({ custom: 'value' })
  })

  it('should attach getGroups and getClaims to ambient context', async () => {
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      getIdentity: () => 'user-claims',
      getGroups: () => ['beta', 'staff'],
      getClaims: () => ({ role: 'admin', plan: 'pro' }),
    })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const context = (req as TogglyRequest).toggly?.context
    expect(context?.identity).toBe('user-claims')
    expect(context?.groups).toEqual(['beta', 'staff'])
    expect(context?.claims).toEqual({ role: 'admin', plan: 'pro' })
  })

  it('should fill request.country from cf-ipcountry when getContext omits request', async () => {
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      getContext: () => ({
        identity: 'ctx-user',
        groups: ['admin'],
        claims: { role: 'admin' },
      }),
    })
    const req = createMockRequest({
      headers: { 'cf-ipcountry': 'DE', 'user-agent': 'Chrome/120' },
    })
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const context = (req as TogglyRequest).toggly?.context
    expect(context?.identity).toBe('ctx-user')
    expect(context?.groups).toEqual(['admin'])
    expect(context?.claims).toEqual({ role: 'admin' })
    expect(context?.request?.country).toBe('DE')
    expect(context?.request?.userAgent).toBe('Chrome/120')
  })

  it('should enrich partial getContext.request from headers', async () => {
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      getContext: () => ({
        identity: 'ctx-user',
        request: { country: 'US' },
      }),
    })
    const req = createMockRequest({
      headers: { 'cf-ipcountry': 'DE', 'user-agent': 'Chrome/120' },
    })
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const context = (req as TogglyRequest).toggly?.context
    expect(context?.request?.country).toBe('US')
    expect(context?.request?.userAgent).toBe('Chrome/120')
  })

  it('should enrich empty getContext.request object from headers', async () => {
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      getContext: () => ({
        identity: 'ctx-user',
        request: {},
      }),
    })
    const req = createMockRequest({
      headers: { 'cf-ipcountry': 'FR', 'user-agent': 'Firefox/121' },
    })
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const context = (req as TogglyRequest).toggly?.context
    expect(context?.request?.country).toBe('FR')
    expect(context?.request?.userAgent).toBe('Firefox/121')
  })

  it('should provide feature checking functions', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const toggly = (req as TogglyRequest).toggly!
    expect(await toggly.isFeatureOn('feature-a')).toBe(true)
    expect(await toggly.isFeatureOn('feature-b')).toBe(false)
    expect(await toggly.isFeatureOff('feature-a')).toBe(false)
    expect(await toggly.isFeatureOff('feature-b')).toBe(true)
  })

  it('should provide evaluateFeatureGate function', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    const toggly = (req as TogglyRequest).toggly!
    expect(await toggly.evaluateFeatureGate(['feature-a'], 'all')).toBe(true)
    expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')).toBe(false)
    expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')).toBe(true)
  })

  it('should use custom error handler for middleware errors', async () => {
    const onError = vi.fn()

    // First, initialize normally
    const middleware = togglyMiddleware({
      appKey: 'test-app',
      onError,
      // Use a custom context extractor that throws
      getContext: () => {
        throw new Error('Context extraction failed')
      },
    })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(onError).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('should gracefully degrade when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const middleware = togglyMiddleware({
      appKey: 'test-app',
    })
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    // Should still complete without throwing
    await middleware(req, res, next)

    // Middleware should call next (graceful degradation)
    expect(next).toHaveBeenCalled()

    // Client should be attached with default/empty features
    const toggly = (req as TogglyRequest).toggly!
    expect(toggly).toBeDefined()
    expect(toggly.features).toBeDefined()
  })

  it('should reuse existing client', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })

    const req1 = createMockRequest()
    const req2 = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    await middleware(req1, res, next)
    await middleware(req2, res, next)

    // Fetch should only be called once (client reused)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('featureGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeExpressToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

          { featureKey: 'enabled-feature', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'disabled-feature', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
      text: async () => JSON.stringify([

          { featureKey: 'enabled-feature', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'disabled-feature', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
    })
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('should call next when feature is enabled', async () => {
    // Setup request with toggly
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    const setupNext = vi.fn()
    await middleware(req, res, setupNext)

    // Apply feature gate
    const gate = featureGate({ featureKey: 'enabled-feature' })
    const next = vi.fn()
    await gate(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should return 404 when feature is disabled', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const gate = featureGate({ featureKey: 'disabled-feature' })
    const next = vi.fn()
    await gate(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(404)
  })

  it('should redirect when redirectTo is specified', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const gate = featureGate({
      featureKey: 'disabled-feature',
      redirectTo: '/coming-soon',
      redirectStatus: 307,
    })
    const next = vi.fn()
    await gate(req, res, next)

    expect(res._status).toBe(307)
    expect(res._redirectUrl).toBe('/coming-soon')
  })

  it('should use custom onDisabled handler', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const onDisabled = vi.fn((_req, mockRes, _next) => {
      mockRes.status(403).json({ error: 'Feature not available' })
    })

    const gate = featureGate({
      featureKey: 'disabled-feature',
      onDisabled,
    })
    await gate(req, res, vi.fn())

    expect(onDisabled).toHaveBeenCalled()
    expect(res._status).toBe(403)
  })

  it('should support multiple features with all requirement', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const gate = featureGate({
      featureKey: ['enabled-feature', 'disabled-feature'],
      requirement: 'all',
    })
    const next = vi.fn()
    await gate(req, res, next)

    expect(next).not.toHaveBeenCalled() // Both features not enabled
    expect(res._status).toBe(404)
  })

  it('should support multiple features with any requirement', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const gate = featureGate({
      featureKey: ['enabled-feature', 'disabled-feature'],
      requirement: 'any',
    })
    const next = vi.fn()
    await gate(req, res, next)

    expect(next).toHaveBeenCalled() // At least one is enabled
  })

  it('should support negation', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    // Negating enabled feature should block
    const gate = featureGate({
      featureKey: 'enabled-feature',
      negate: true,
    })
    const next = vi.fn()
    await gate(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(404)
  })

  it('should fail if toggly middleware not applied', async () => {
    const req = createMockRequest()
    const res = createMockResponse()
    const next = vi.fn()

    const gate = featureGate({ featureKey: 'any-feature' })
    await gate(req, res, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('featureRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeExpressToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

          { featureKey: 'beta-feature', filters: [{ name: 'AlwaysOff', parameters: {} }] },
          { featureKey: 'admin-feature', filters: [{ name: 'AlwaysOn', parameters: {} }] },

        ]),
      text: async () => JSON.stringify([

          { featureKey: 'beta-feature', filters: [{ name: 'AlwaysOff', parameters: {} }] },
          { featureKey: 'admin-feature', filters: [{ name: 'AlwaysOn', parameters: {} }] },

        ]),
    })
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('should apply feature gate for matching routes', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const routeMiddleware = featureRoutes([
      { path: '/beta', featureKey: 'beta-feature' },
    ])

    const req = createMockRequest({ path: '/beta' })
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const next = vi.fn()
    await routeMiddleware(req, res, next)

    expect(res._status).toBe(404) // beta-feature is disabled
  })

  it('should not apply gate for non-matching routes', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const routeMiddleware = featureRoutes([
      { path: '/beta', featureKey: 'beta-feature' },
    ])

    const req = createMockRequest({ path: '/public' })
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const next = vi.fn()
    await routeMiddleware(req, res, next)

    expect(next).toHaveBeenCalled() // Route doesn't match, continue
  })

  it('should support regex patterns', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const routeMiddleware = featureRoutes([
      { path: /^\/admin/, featureKey: 'admin-feature' },
    ])

    const req = createMockRequest({ path: '/admin/users' })
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const next = vi.fn()
    await routeMiddleware(req, res, next)

    expect(next).toHaveBeenCalled() // admin-feature is enabled
  })

  it('should filter by HTTP method', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const routeMiddleware = featureRoutes([
      { path: '/beta', featureKey: 'beta-feature', methods: ['POST'] },
    ])

    const req = createMockRequest({ path: '/beta', method: 'GET' })
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const next = vi.fn()
    await routeMiddleware(req, res, next)

    expect(next).toHaveBeenCalled() // Method doesn't match, continue
  })
})

describe('withFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeExpressToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([
{ featureKey: 'my-feature', filters: [{ name: 'AlwaysOn', parameters: {} }] }
        ]),
      text: async () => JSON.stringify([
{ featureKey: 'my-feature', filters: [{ name: 'AlwaysOn', parameters: {} }] }
        ]),
    })
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('should execute handler when feature is enabled', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const handler = vi.fn((_req, res) => res.json({ success: true }))
    const wrappedHandler = withFeature('my-feature', handler)

    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const next = vi.fn()
    await wrappedHandler(req, res, next)

    expect(handler).toHaveBeenCalled()
  })
})

describe('featuresHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeExpressToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

          { featureKey: 'feature-a', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'feature-b', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
      text: async () => JSON.stringify([

          { featureKey: 'feature-a', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'feature-b', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
    })
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('should return features as JSON', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest({ headers: { 'x-toggly-identity': 'user-123' } })
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    const handler = featuresHandler()
    handler(req, res, vi.fn())

    expect(res._json).toEqual({
      features: { 'feature-a': true, 'feature-b': false },
      identity: 'user-123',
    })
  })

  it('should return error if middleware not configured', () => {
    const req = createMockRequest()
    const res = createMockResponse()

    const handler = featuresHandler()
    handler(req, res, vi.fn())

    expect(res._status).toBe(500)
    expect(res._json).toEqual({
      error: 'Internal Server Error',
      message: 'Toggly middleware not configured',
    })
  })
})

describe('getExpressToggly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeExpressToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

        ]),
      text: async () => JSON.stringify([

        ]),
    })
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('should return null before middleware is applied', () => {
    expect(getExpressToggly()).toBeNull()
  })

  it('should return client after middleware is applied', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    expect(getExpressToggly()).not.toBeNull()
  })
})

describe('closeExpressToggly', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

        ]),
      text: async () => JSON.stringify([

        ]),
    })
  })

  it('should close and clear the client', async () => {
    const middleware = togglyMiddleware({ appKey: 'test-app' })
    const req = createMockRequest()
    const res = createMockResponse()
    await middleware(req, res, vi.fn())

    expect(getExpressToggly()).not.toBeNull()

    closeExpressToggly()

    expect(getExpressToggly()).toBeNull()
  })

  it('should be safe to call multiple times', () => {
    expect(() => {
      closeExpressToggly()
      closeExpressToggly()
      closeExpressToggly()
    }).not.toThrow()
  })
})
