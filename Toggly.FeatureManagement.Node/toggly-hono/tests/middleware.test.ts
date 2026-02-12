import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  togglyMiddleware,
  featureGate,
  featureRoutes,
  withFeature,
  featuresHandler,
  getHonoToggly,
  closeHonoToggly,
} from '../src/middleware'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('togglyMiddleware', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    closeHonoToggly()

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

    app = new Hono()
  })

  afterEach(() => {
    closeHonoToggly()
  })

  it('should initialize client and attach toggly to context', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))

    app.get('/test', (c) => {
      const toggly = c.get('toggly')
      expect(toggly).toBeDefined()
      expect(toggly.features).toBeDefined()
      expect(toggly.isFeatureOn).toBeDefined()
      expect(toggly.isFeatureOff).toBeDefined()
      expect(toggly.evaluateFeatureGate).toBeDefined()
      return c.json({ success: true })
    })

    const response = await app.request('/test')
    expect(response.status).toBe(200)
  })

  it('should extract identity from header', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))

    app.get('/test', (c) => {
      const toggly = c.get('toggly')
      expect(toggly.identity).toBe('user-123')
      return c.json({ success: true })
    })

    await app.request('/test', {
      headers: { 'x-toggly-identity': 'user-123' },
    })
  })

  it('should use custom identity extractor', async () => {
    app.use(
      '*',
      togglyMiddleware({
        appKey: 'test-app',
        getIdentity: (c) => c.req.header('x-user-id'),
      })
    )

    app.get('/test', (c) => {
      const toggly = c.get('toggly')
      expect(toggly.identity).toBe('custom-user-456')
      return c.json({ success: true })
    })

    await app.request('/test', {
      headers: { 'x-user-id': 'custom-user-456' },
    })
  })

  it('should use custom context extractor', async () => {
    app.use(
      '*',
      togglyMiddleware({
        appKey: 'test-app',
        getContext: () => ({
          identity: 'ctx-user',
          groups: ['admin'],
          traits: { custom: 'value' },
        }),
      })
    )

    app.get('/test', (c) => {
      const toggly = c.get('toggly')
      expect(toggly.context.identity).toBe('ctx-user')
      expect(toggly.context.groups).toEqual(['admin'])
      expect(toggly.context.traits?.custom).toBe('value')
      return c.json({ success: true })
    })

    await app.request('/test')
  })

  it('should provide feature checking functions', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))

    app.get('/test', async (c) => {
      const toggly = c.get('toggly')
      expect(await toggly.isFeatureOn('feature-a')).toBe(true)
      expect(await toggly.isFeatureOn('feature-b')).toBe(false)
      expect(await toggly.isFeatureOff('feature-a')).toBe(false)
      expect(await toggly.isFeatureOff('feature-b')).toBe(true)
      return c.json({ success: true })
    })

    await app.request('/test')
  })

  it('should provide evaluateFeatureGate function', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))

    app.get('/test', async (c) => {
      const toggly = c.get('toggly')
      expect(await toggly.evaluateFeatureGate(['feature-a'], 'all')).toBe(true)
      expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')).toBe(false)
      expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')).toBe(true)
      return c.json({ success: true })
    })

    await app.request('/test')
  })

  it('should gracefully degrade when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    app.use('*', togglyMiddleware({ appKey: 'test-app' }))

    app.get('/test', (c) => {
      const toggly = c.get('toggly')
      expect(toggly).toBeDefined()
      expect(toggly.features).toBeDefined()
      return c.json({ success: true })
    })

    const response = await app.request('/test')
    expect(response.status).toBe(200)
  })

  it('should reuse existing client', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.get('/test', (c) => c.json({ success: true }))

    await app.request('/test')
    await app.request('/test')

    // Fetch should only be called once (client reused)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('featureGate', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    closeHonoToggly()

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

    app = new Hono()
  })

  afterEach(() => {
    closeHonoToggly()
  })

  it('should call next when feature is enabled', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('/protected/*', featureGate({ featureKey: 'feature-a' }))
    app.get('/protected/test', (c) => c.json({ protected: true }))

    const response = await app.request('/protected/test')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ protected: true })
  })

  it('should return 404 when feature is disabled', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('/protected/*', featureGate({ featureKey: 'feature-b' }))
    app.get('/protected/test', (c) => c.json({ protected: true }))

    const response = await app.request('/protected/test')
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Not Found')
  })

  it('should redirect when redirectTo is specified', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use(
      '/protected/*',
      featureGate({
        featureKey: 'feature-b',
        redirectTo: '/disabled',
        redirectStatus: 303,
      })
    )
    app.get('/protected/test', (c) => c.json({ protected: true }))

    const response = await app.request('/protected/test', { redirect: 'manual' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/disabled')
  })

  it('should use custom onDisabled handler', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use(
      '/protected/*',
      featureGate({
        featureKey: 'feature-b',
        onDisabled: (c) => c.json({ custom: 'disabled' }, 403),
      })
    )
    app.get('/protected/test', (c) => c.json({ protected: true }))

    const response = await app.request('/protected/test')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ custom: 'disabled' })
  })

  it('should support multiple features with all requirement', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use(
      '/all-features/*',
      featureGate({
        featureKey: ['feature-a', 'feature-b'],
        requirement: 'all',
      })
    )
    app.get('/all-features/test', (c) => c.json({ success: true }))

    const response = await app.request('/all-features/test')
    expect(response.status).toBe(404) // feature-b is disabled
  })

  it('should support multiple features with any requirement', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use(
      '/any-features/*',
      featureGate({
        featureKey: ['feature-a', 'feature-b'],
        requirement: 'any',
      })
    )
    app.get('/any-features/test', (c) => c.json({ success: true }))

    const response = await app.request('/any-features/test')
    expect(response.status).toBe(200) // feature-a is enabled
  })

  it('should support negation', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('/negated/*', featureGate({ featureKey: 'feature-b', negate: true }))
    app.get('/negated/test', (c) => c.json({ success: true }))

    const response = await app.request('/negated/test')
    expect(response.status).toBe(200) // feature-b is disabled, negated = enabled
  })

  it('should fail if toggly middleware not applied', async () => {
    app.use('/protected/*', featureGate({ featureKey: 'feature-a' }))
    app.get('/protected/test', (c) => c.json({ protected: true }))

    const response = await app.request('/protected/test')
    expect(response.status).toBe(500)
  })
})

describe('featureRoutes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    closeHonoToggly()

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

    app = new Hono()
  })

  afterEach(() => {
    closeHonoToggly()
  })

  it('should apply feature gate for matching routes', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('*', featureRoutes([{ path: '/beta', featureKey: 'beta' }]))
    app.get('/beta', (c) => c.json({ beta: true }))
    app.get('/public', (c) => c.json({ public: true }))

    const betaResponse = await app.request('/beta')
    const publicResponse = await app.request('/public')

    expect(betaResponse.status).toBe(200)
    expect(publicResponse.status).toBe(200)
  })

  it('should not apply gate for non-matching routes', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('*', featureRoutes([{ path: '/admin', featureKey: 'admin' }]))
    app.get('/admin', (c) => c.json({ admin: true }))
    app.get('/user', (c) => c.json({ user: true }))

    const adminResponse = await app.request('/admin')
    const userResponse = await app.request('/user')

    expect(adminResponse.status).toBe(404) // admin feature disabled
    expect(userResponse.status).toBe(200) // no gate applied
  })

  it('should support regex patterns', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('*', featureRoutes([{ path: /^\/beta\/.*/, featureKey: 'beta' }]))
    app.get('/beta/test', (c) => c.json({ beta: true }))

    const response = await app.request('/beta/test')
    expect(response.status).toBe(200)
  })

  it('should filter by HTTP method', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.use('*', featureRoutes([{ path: '/admin', featureKey: 'admin', methods: ['POST'] }]))
    app.get('/admin', (c) => c.json({ success: true }))
    app.post('/admin', (c) => c.json({ success: true }))

    const getResponse = await app.request('/admin')
    const postResponse = await app.request('/admin', { method: 'POST' })

    expect(getResponse.status).toBe(200) // GET not filtered
    expect(postResponse.status).toBe(404) // POST filtered, admin disabled
  })
})

describe('withFeature', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    closeHonoToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        features: [{ featureKey: 'my-feature', enabled: true }],
      }),
    })

    app = new Hono()
  })

  afterEach(() => {
    closeHonoToggly()
  })

  it('should execute handler when feature is enabled', async () => {
    const handler = vi.fn((c) => c.json({ success: true }))

    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.get('/test', withFeature('my-feature', handler))

    const response = await app.request('/test')
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })
})

describe('featuresHandler', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    closeHonoToggly()

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

    app = new Hono()
  })

  afterEach(() => {
    closeHonoToggly()
  })

  it('should return features as JSON', async () => {
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.get('/features', featuresHandler)

    const response = await app.request('/features')
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.features).toBeDefined()
    expect(data.features['feature-a']).toBe(true)
    expect(data.features['feature-b']).toBe(false)
  })

  it('should return error if middleware not configured', async () => {
    app.get('/features', featuresHandler)

    const response = await app.request('/features')
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('Internal Server Error')
  })
})

describe('getHonoToggly', () => {
  beforeEach(() => {
    closeHonoToggly()
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
    closeHonoToggly()
  })

  it('should return null before middleware is applied', () => {
    expect(getHonoToggly()).toBeNull()
  })

  it('should return client after middleware is applied', async () => {
    const app = new Hono()
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.get('/test', (c) => c.json({ success: true }))

    await app.request('/test')

    expect(getHonoToggly()).not.toBeNull()
  })
})

describe('closeHonoToggly', () => {
  beforeEach(() => {
    closeHonoToggly()
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
    const app = new Hono()
    app.use('*', togglyMiddleware({ appKey: 'test-app' }))
    app.get('/test', (c) => c.json({ success: true }))

    await app.request('/test')
    expect(getHonoToggly()).not.toBeNull()

    closeHonoToggly()
    expect(getHonoToggly()).toBeNull()
  })

  it('should be safe to call multiple times', () => {
    expect(() => {
      closeHonoToggly()
      closeHonoToggly()
      closeHonoToggly()
    }).not.toThrow()
  })
})
