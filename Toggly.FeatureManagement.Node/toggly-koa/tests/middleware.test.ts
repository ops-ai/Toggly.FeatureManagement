import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Koa from 'koa'
import type { Context, Next } from 'koa'
import {
  togglyMiddleware,
  featureGate,
  featureRoutes,
  withFeature,
  featuresHandler,
  getKoaToggly,
  closeKoaToggly,
} from '../src/middleware'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Helper to make requests to Koa app
async function makeRequest(
  app: Koa,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const mockRes = {
    _status: undefined as number | undefined,
    _body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value
    },
  }

  const ctx = {
    method,
    path,
    url: path,
    ip: '127.0.0.1',
    headers,
    state: {},
    get(key: string) {
      return headers[key.toLowerCase()] || ''
    },
    set status(code: number) {
      mockRes._status = code
    },
    get status() {
      return mockRes._status ?? 404
    },
    set body(data: unknown) {
      mockRes._body = data
      // Only default to 200 if status was NOT explicitly set
      if (mockRes._status === undefined) {
        mockRes._status = 200
      }
    },
    get body() {
      return mockRes._body
    },
    redirect(url: string) {
      mockRes.headers.location = url
      // Status should be set separately
    },
  } as unknown as Context

  const middleware = app.middleware
  let index = -1

  const dispatch = async (i: number): Promise<void> => {
    if (i <= index) {
      throw new Error('next() called multiple times')
    }
    index = i
    const fn = middleware[i]
    if (!fn) {
      return
    }
    await fn(ctx, () => dispatch(i + 1))
  }

  try {
    await dispatch(0)
  } catch (error) {
    mockRes._status = 500
    mockRes._body = { error: (error as Error).message }
  }

  return {
    status: mockRes._status ?? 404,
    body: mockRes._body,
    headers: mockRes.headers,
  }
}

describe('togglyMiddleware', () => {
  let app: Koa

  beforeEach(() => {
    vi.clearAllMocks()
    closeKoaToggly()

    // Default mock response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      }),
    })

    app = new Koa()
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('should initialize client and attach toggly to context', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      expect(ctx.state.toggly).toBeDefined()
      expect(ctx.state.toggly!.features).toBeDefined()
      expect(ctx.state.toggly!.isFeatureOn).toBeDefined()
      expect(ctx.state.toggly!.isFeatureOff).toBeDefined()
      expect(ctx.state.toggly!.evaluateFeatureGate).toBeDefined()
      ctx.body = { success: true }
    })

    const response = await makeRequest(app, 'GET', '/test')
    expect(response.status).toBe(200)
  })

  it('should extract identity from header', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      expect(ctx.state.toggly!.identity).toBe('user-123')
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test', { 'x-toggly-identity': 'user-123' })
  })

  it('should use custom identity extractor', async () => {
    app.use(
      togglyMiddleware({
        appKey: 'test-app',
        getIdentity: (ctx) => ctx.get('x-user-id'),
      })
    )
    app.use(async (ctx: Context) => {
      expect(ctx.state.toggly!.identity).toBe('custom-user-456')
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test', { 'x-user-id': 'custom-user-456' })
  })

  it('should use custom context extractor', async () => {
    app.use(
      togglyMiddleware({
        appKey: 'test-app',
        getContext: () => ({
          identity: 'ctx-user',
          groups: ['admin'],
          traits: { custom: 'value' },
        }),
      })
    )
    app.use(async (ctx: Context) => {
      expect(ctx.state.toggly!.context.identity).toBe('ctx-user')
      expect(ctx.state.toggly!.context.groups).toEqual(['admin'])
      expect(ctx.state.toggly!.context.traits?.custom).toBe('value')
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test')
  })

  it('should provide feature checking functions', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      const toggly = ctx.state.toggly!
      expect(await toggly.isFeatureOn('feature-a')).toBe(true)
      expect(await toggly.isFeatureOn('feature-b')).toBe(false)
      expect(await toggly.isFeatureOff('feature-a')).toBe(false)
      expect(await toggly.isFeatureOff('feature-b')).toBe(true)
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test')
  })

  it('should provide evaluateFeatureGate function', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      const toggly = ctx.state.toggly!
      expect(await toggly.evaluateFeatureGate(['feature-a'], 'all')).toBe(true)
      expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')).toBe(false)
      expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')).toBe(true)
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test')
  })

  it('should gracefully degrade when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      expect(ctx.state.toggly).toBeDefined()
      expect(ctx.state.toggly!.features).toBeDefined()
      ctx.body = { success: true }
    })

    const response = await makeRequest(app, 'GET', '/test')
    expect(response.status).toBe(200)
  })

  it('should reuse existing client', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test')
    await makeRequest(app, 'GET', '/test')

    // Fetch should only be called once (client reused)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('featureGate', () => {
  let app: Koa

  beforeEach(() => {
    vi.clearAllMocks()
    closeKoaToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      }),
    })

    app = new Koa()
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('should call next when feature is enabled', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureGate({ featureKey: 'feature-a' }))
    app.use(async (ctx: Context) => {
      ctx.body = { protected: true }
    })

    const response = await makeRequest(app, 'GET', '/protected')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ protected: true })
  })

  it('should return 404 when feature is disabled', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureGate({ featureKey: 'feature-b' }))
    app.use(async (ctx: Context) => {
      ctx.body = { protected: true }
    })

    const response = await makeRequest(app, 'GET', '/protected')
    expect(response.status).toBe(404)
    expect((response.body as { error: string }).error).toBe('Not Found')
  })

  it('should redirect when redirectTo is specified', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(
      featureGate({
        featureKey: 'feature-b',
        redirectTo: '/disabled',
        redirectStatus: 303,
      })
    )
    app.use(async (ctx: Context) => {
      ctx.body = { protected: true }
    })

    const response = await makeRequest(app, 'GET', '/protected')
    expect(response.status).toBe(303)
    expect(response.headers.location).toBe('/disabled')
  })

  it('should use custom onDisabled handler', async () => {
    const onDisabled = vi.fn(async (ctx: Context) => {
      ctx.status = 403
      ctx.body = { custom: 'disabled' }
    })

    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureGate({ featureKey: 'feature-b', onDisabled }))
    app.use(async (ctx: Context) => {
      ctx.body = { protected: true }
    })

    const response = await makeRequest(app, 'GET', '/protected')
    expect(response.status).toBe(403)
    expect(onDisabled).toHaveBeenCalled()
  })

  it('should support multiple features with all requirement', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureGate({ featureKey: ['feature-a', 'feature-b'], requirement: 'all' }))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const response = await makeRequest(app, 'GET', '/test')
    expect(response.status).toBe(404) // feature-b is disabled
  })

  it('should support multiple features with any requirement', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureGate({ featureKey: ['feature-a', 'feature-b'], requirement: 'any' }))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const response = await makeRequest(app, 'GET', '/test')
    expect(response.status).toBe(200) // feature-a is enabled
  })

  it('should support negation', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureGate({ featureKey: 'feature-b', negate: true }))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const response = await makeRequest(app, 'GET', '/test')
    expect(response.status).toBe(200) // feature-b is disabled, negated = enabled
  })

  it('should fail if toggly middleware not applied', async () => {
    app.use(featureGate({ featureKey: 'feature-a' }))
    app.use(async (ctx: Context) => {
      ctx.body = { protected: true }
    })

    const response = await makeRequest(app, 'GET', '/protected')
    expect(response.status).toBe(500)
  })
})

describe('featureRoutes', () => {
  let app: Koa

  beforeEach(() => {
    vi.clearAllMocks()
    closeKoaToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [
          { featureKey: 'beta', enabled: true },
          { featureKey: 'admin', enabled: false },
        ],
      }),
    })

    app = new Koa()
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('should apply feature gate for matching routes', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureRoutes([{ path: '/beta', featureKey: 'beta' }]))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const betaResponse = await makeRequest(app, 'GET', '/beta')
    const publicResponse = await makeRequest(app, 'GET', '/public')

    expect(betaResponse.status).toBe(200)
    expect(publicResponse.status).toBe(200)
  })

  it('should not apply gate for non-matching routes', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureRoutes([{ path: '/admin', featureKey: 'admin' }]))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const adminResponse = await makeRequest(app, 'GET', '/admin')
    const userResponse = await makeRequest(app, 'GET', '/user')

    expect(adminResponse.status).toBe(404) // admin feature disabled
    expect(userResponse.status).toBe(200) // no gate applied
  })

  it('should support regex patterns', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureRoutes([{ path: /^\/beta\/.*/, featureKey: 'beta' }]))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const response = await makeRequest(app, 'GET', '/beta/test')
    expect(response.status).toBe(200)
  })

  it('should filter by HTTP method', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featureRoutes([{ path: '/admin', featureKey: 'admin', methods: ['POST'] }]))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    const getResponse = await makeRequest(app, 'GET', '/admin')
    const postResponse = await makeRequest(app, 'POST', '/admin')

    expect(getResponse.status).toBe(200) // GET not filtered
    expect(postResponse.status).toBe(404) // POST filtered, admin disabled
  })
})

describe('withFeature', () => {
  let app: Koa

  beforeEach(() => {
    vi.clearAllMocks()
    closeKoaToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [{ featureKey: 'my-feature', enabled: true }],
      }),
    })

    app = new Koa()
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('should execute handler when feature is enabled', async () => {
    const handler = vi.fn(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(withFeature('my-feature', handler))

    const response = await makeRequest(app, 'GET', '/test')
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })
})

describe('featuresHandler', () => {
  let app: Koa

  beforeEach(() => {
    vi.clearAllMocks()
    closeKoaToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      }),
    })

    app = new Koa()
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('should return features as JSON', async () => {
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(featuresHandler())

    const response = await makeRequest(app, 'GET', '/features')
    expect(response.status).toBe(200)

    const body = response.body as { features: Record<string, boolean> }
    expect(body.features).toBeDefined()
    expect(body.features['feature-a']).toBe(true)
    expect(body.features['feature-b']).toBe(false)
  })

  it('should return error if middleware not configured', async () => {
    app.use(featuresHandler())

    const response = await makeRequest(app, 'GET', '/features')
    expect(response.status).toBe(500)
    expect((response.body as { error: string }).error).toBe('Internal Server Error')
  })
})

describe('getKoaToggly', () => {
  beforeEach(() => {
    closeKoaToggly()
    vi.clearAllMocks()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [],
      }),
    })
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('should return null before middleware is applied', () => {
    expect(getKoaToggly()).toBeNull()
  })

  it('should return client after middleware is applied', async () => {
    const app = new Koa()
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test')

    expect(getKoaToggly()).not.toBeNull()
  })
})

describe('closeKoaToggly', () => {
  beforeEach(() => {
    closeKoaToggly()
    vi.clearAllMocks()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [],
      }),
    })
  })

  it('should close and clear the client', async () => {
    const app = new Koa()
    app.use(togglyMiddleware({ appKey: 'test-app' }))
    app.use(async (ctx: Context) => {
      ctx.body = { success: true }
    })

    await makeRequest(app, 'GET', '/test')
    expect(getKoaToggly()).not.toBeNull()

    closeKoaToggly()
    expect(getKoaToggly()).toBeNull()
  })

  it('should be safe to call multiple times', () => {
    expect(() => {
      closeKoaToggly()
      closeKoaToggly()
      closeKoaToggly()
    }).not.toThrow()
  })
})
