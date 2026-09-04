import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import {
  togglyPlugin,
  featureGate,
  featureRoutes,
  withFeature,
  featuresHandler,
  getFastifyToggly,
  closeFastifyToggly,
} from '../src/plugin'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('togglyPlugin', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    closeFastifyToggly()

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

    app = Fastify()
  })

  afterEach(async () => {
    closeFastifyToggly()
    await app.close()
  })

  it('should initialize client and attach toggly to request', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async (request, reply) => {
      expect(request.toggly).toBeDefined()
      expect(request.toggly!.features).toBeDefined()
      expect(request.toggly!.isFeatureOn).toBeDefined()
      expect(request.toggly!.isFeatureOff).toBeDefined()
      expect(request.toggly!.evaluateFeatureGate).toBeDefined()
      return { success: true }
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    })

    expect(response.statusCode).toBe(200)
  })

  it('should extract identity from header', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async (request, reply) => {
      expect(request.toggly!.identity).toBe('user-123')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-toggly-identity': 'user-123' },
    })
  })

  it('should set request.country from cf-ipcountry via fromHttpRequest', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async (request) => {
      expect(request.toggly!.context.request?.country).toBe('US')
      expect(request.toggly!.context.request?.userAgent).toBe('Chrome/120')
      expect(request.toggly!.context.traits?.userAgent).toBe('Chrome/120')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-ipcountry': 'US',
        'user-agent': 'Chrome/120',
      },
    })
  })

  it('should use custom identity extractor', async () => {
    await app.register(togglyPlugin, {
      appKey: 'test-app',
      getIdentity: (request) => request.headers['x-user-id'] as string,
    })

    app.get('/test', async (request, reply) => {
      expect(request.toggly!.identity).toBe('custom-user-456')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-user-id': 'custom-user-456' },
    })
  })

  it('should use custom context extractor', async () => {
    await app.register(togglyPlugin, {
      appKey: 'test-app',
      getContext: (request) => ({
        identity: 'ctx-user',
        groups: ['admin'],
        traits: { custom: 'value' },
      }),
    })

    app.get('/test', async (request, reply) => {
      expect(request.toggly!.context.identity).toBe('ctx-user')
      expect(request.toggly!.context.groups).toEqual(['admin'])
      expect(request.toggly!.context.traits?.custom).toBe('value')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
    })
  })

  it('should attach getGroups and getClaims to ambient context', async () => {
    await app.register(togglyPlugin, {
      appKey: 'test-app',
      getIdentity: () => 'user-claims',
      getGroups: () => ['beta', 'staff'],
      getClaims: () => ({ role: 'admin', plan: 'pro' }),
    })

    app.get('/test', async (request) => {
      expect(request.toggly!.context.identity).toBe('user-claims')
      expect(request.toggly!.context.groups).toEqual(['beta', 'staff'])
      expect(request.toggly!.context.claims).toEqual({ role: 'admin', plan: 'pro' })
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
    })
  })

  it('should fill request.country from cf-ipcountry when getContext omits request', async () => {
    await app.register(togglyPlugin, {
      appKey: 'test-app',
      getContext: () => ({
        identity: 'ctx-user',
        groups: ['admin'],
        claims: { role: 'admin' },
      }),
    })

    app.get('/test', async (request) => {
      expect(request.toggly!.context.identity).toBe('ctx-user')
      expect(request.toggly!.context.groups).toEqual(['admin'])
      expect(request.toggly!.context.claims).toEqual({ role: 'admin' })
      expect(request.toggly!.context.request?.country).toBe('DE')
      expect(request.toggly!.context.request?.userAgent).toBe('Chrome/120')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-ipcountry': 'DE',
        'user-agent': 'Chrome/120',
      },
    })
  })

  it('should enrich partial getContext.request from headers', async () => {
    await app.register(togglyPlugin, {
      appKey: 'test-app',
      getContext: () => ({
        identity: 'ctx-user',
        request: { country: 'US' },
      }),
    })

    app.get('/test', async (request) => {
      expect(request.toggly!.context.request?.country).toBe('US')
      expect(request.toggly!.context.request?.userAgent).toBe('Chrome/120')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-ipcountry': 'DE',
        'user-agent': 'Chrome/120',
      },
    })
  })

  it('should enrich empty getContext.request object from headers', async () => {
    await app.register(togglyPlugin, {
      appKey: 'test-app',
      getContext: () => ({
        identity: 'ctx-user',
        request: {},
      }),
    })

    app.get('/test', async (request) => {
      expect(request.toggly!.context.request?.country).toBe('FR')
      expect(request.toggly!.context.request?.userAgent).toBe('Firefox/121')
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'cf-ipcountry': 'FR',
        'user-agent': 'Firefox/121',
      },
    })
  })

  it('should provide feature checking functions', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async (request, reply) => {
      expect(await request.toggly!.isFeatureOn('feature-a')).toBe(true)
      expect(await request.toggly!.isFeatureOn('feature-b')).toBe(false)
      expect(await request.toggly!.isFeatureOff('feature-a')).toBe(false)
      expect(await request.toggly!.isFeatureOff('feature-b')).toBe(true)
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
    })
  })

  it('should provide evaluateFeatureGate function', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async (request, reply) => {
      const toggly = request.toggly!
      expect(await toggly.evaluateFeatureGate(['feature-a'], 'all')).toBe(true)
      expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'all')).toBe(false)
      expect(await toggly.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')).toBe(true)
      return { success: true }
    })

    await app.inject({
      method: 'GET',
      url: '/test',
    })
  })

  it('should gracefully degrade when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async (request, reply) => {
      // Client should be attached with default/empty features
      expect(request.toggly).toBeDefined()
      expect(request.toggly!.features).toBeDefined()
      return { success: true }
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    })

    expect(response.statusCode).toBe(200)
  })

  it('should reuse existing client across requests', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', async () => ({ success: true }))

    await app.inject({ method: 'GET', url: '/test' })
    await app.inject({ method: 'GET', url: '/test' })

    // Fetch should only be called once (client reused)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

describe('featureGate', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    closeFastifyToggly()

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

    app = Fastify()
  })

  afterEach(async () => {
    closeFastifyToggly()
    await app.close()
  })

  it('should allow access when feature is enabled', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/protected', { preHandler: featureGate({ featureKey: 'feature-a' }) }, async () => {
      return { protected: true }
    })

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ protected: true })
  })

  it('should return 404 when feature is disabled', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/protected', { preHandler: featureGate({ featureKey: 'feature-b' }) }, async () => {
      return { protected: true }
    })

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().error).toBe('Not Found')
  })

  it('should redirect when redirectTo is specified', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get(
      '/protected',
      {
        preHandler: featureGate({
          featureKey: 'feature-b',
          redirectTo: '/disabled',
          redirectStatus: 303,
        }),
      },
      async () => {
        return { protected: true }
      }
    )

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    })

    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe('/disabled')
  })

  it('should use custom onDisabled handler', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    const onDisabled = vi.fn()
    app.get(
      '/protected',
      {
        preHandler: featureGate({
          featureKey: 'feature-b',
          onDisabled,
        }),
      },
      async () => {
        return { protected: true }
      }
    )

    await app.inject({
      method: 'GET',
      url: '/protected',
    })

    expect(onDisabled).toHaveBeenCalled()
  })

  it('should support multiple features with all requirement', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get(
      '/all-features',
      {
        preHandler: featureGate({
          featureKey: ['feature-a', 'feature-b'],
          requirement: 'all',
        }),
      },
      async () => {
        return { success: true }
      }
    )

    const response = await app.inject({
      method: 'GET',
      url: '/all-features',
    })

    expect(response.statusCode).toBe(404) // feature-b is disabled
  })

  it('should support multiple features with any requirement', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get(
      '/any-features',
      {
        preHandler: featureGate({
          featureKey: ['feature-a', 'feature-b'],
          requirement: 'any',
        }),
      },
      async () => {
        return { success: true }
      }
    )

    const response = await app.inject({
      method: 'GET',
      url: '/any-features',
    })

    expect(response.statusCode).toBe(200) // feature-a is enabled
  })

  it('should support negation', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get(
      '/negated',
      {
        preHandler: featureGate({
          featureKey: 'feature-b',
          negate: true,
        }),
      },
      async () => {
        return { success: true }
      }
    )

    const response = await app.inject({
      method: 'GET',
      url: '/negated',
    })

    expect(response.statusCode).toBe(200) // feature-b is disabled, negated = enabled
  })
})

describe('featureRoutes', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    closeFastifyToggly()

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ([

          { featureKey: 'beta', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'admin', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
      text: async () => JSON.stringify([

          { featureKey: 'beta', filters: [{ name: 'AlwaysOn', parameters: {} }] },
          { featureKey: 'admin', filters: [{ name: 'AlwaysOff', parameters: {} }] },

        ]),
    })

    app = Fastify()
  })

  afterEach(async () => {
    closeFastifyToggly()
    await app.close()
  })

  it('should apply feature gate for matching routes', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.addHook(
      'preHandler',
      featureRoutes([{ path: '/beta', featureKey: 'beta' }])
    )

    app.get('/beta', async () => ({ beta: true }))
    app.get('/public', async () => ({ public: true }))

    const betaResponse = await app.inject({ method: 'GET', url: '/beta' })
    const publicResponse = await app.inject({ method: 'GET', url: '/public' })

    expect(betaResponse.statusCode).toBe(200)
    expect(publicResponse.statusCode).toBe(200)
  })

  it('should not apply gate for non-matching routes', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.addHook(
      'preHandler',
      featureRoutes([{ path: '/admin', featureKey: 'admin' }])
    )

    app.get('/admin', async () => ({ admin: true }))
    app.get('/user', async () => ({ user: true }))

    const adminResponse = await app.inject({ method: 'GET', url: '/admin' })
    const userResponse = await app.inject({ method: 'GET', url: '/user' })

    expect(adminResponse.statusCode).toBe(404) // admin feature disabled
    expect(userResponse.statusCode).toBe(200) // no gate applied
  })

  it('should support regex patterns', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.addHook(
      'preHandler',
      featureRoutes([{ path: /^\/beta\/.*/, featureKey: 'beta' }])
    )

    app.get('/beta/test', async () => ({ beta: true }))

    const response = await app.inject({ method: 'GET', url: '/beta/test' })

    expect(response.statusCode).toBe(200)
  })

  it('should filter by HTTP method', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.addHook(
      'preHandler',
      featureRoutes([{ path: '/admin', featureKey: 'admin', methods: ['POST'] }])
    )

    app.get('/admin', async () => ({ success: true }))
    app.post('/admin', async () => ({ success: true }))

    const getResponse = await app.inject({ method: 'GET', url: '/admin' })
    const postResponse = await app.inject({ method: 'POST', url: '/admin' })

    expect(getResponse.statusCode).toBe(200) // GET not filtered
    expect(postResponse.statusCode).toBe(404) // POST filtered, admin disabled
  })
})

describe('withFeature', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    closeFastifyToggly()

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

    app = Fastify()
  })

  afterEach(async () => {
    closeFastifyToggly()
    await app.close()
  })

  it('should work as preHandler shorthand', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/test', { preHandler: withFeature('my-feature') }, async () => {
      return { success: true }
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ success: true })
  })
})

describe('featuresHandler', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    closeFastifyToggly()

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

    app = Fastify()
  })

  afterEach(async () => {
    closeFastifyToggly()
    await app.close()
  })

  it('should return features as JSON', async () => {
    await app.register(togglyPlugin, { appKey: 'test-app' })

    app.get('/features', featuresHandler)

    const response = await app.inject({
      method: 'GET',
      url: '/features',
    })

    expect(response.statusCode).toBe(200)
    const data = response.json()
    expect(data.features).toBeDefined()
    expect(data.features['feature-a']).toBe(true)
    expect(data.features['feature-b']).toBe(false)
  })

  it('should return error if plugin not configured', async () => {
    // Don't register plugin
    app.get('/features', featuresHandler)

    const response = await app.inject({
      method: 'GET',
      url: '/features',
    })

    expect(response.statusCode).toBe(500)
    expect(response.json().error).toBe('Internal Server Error')
  })
})

describe('getFastifyToggly', () => {
  beforeEach(() => {
    closeFastifyToggly()
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

  afterEach(() => {
    closeFastifyToggly()
  })

  it('should return null before plugin is registered', () => {
    expect(getFastifyToggly()).toBeNull()
  })

  it('should return client after plugin is registered', async () => {
    const app = Fastify()
    await app.register(togglyPlugin, { appKey: 'test-app' })
    await app.ready()

    expect(getFastifyToggly()).not.toBeNull()

    await app.close()
  })
})

describe('closeFastifyToggly', () => {
  beforeEach(() => {
    closeFastifyToggly()
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
    const app = Fastify()
    await app.register(togglyPlugin, { appKey: 'test-app' })
    await app.ready()

    expect(getFastifyToggly()).not.toBeNull()

    closeFastifyToggly()

    expect(getFastifyToggly()).toBeNull()

    await app.close()
  })

  it('should be safe to call multiple times', () => {
    expect(() => {
      closeFastifyToggly()
      closeFastifyToggly()
      closeFastifyToggly()
    }).not.toThrow()
  })
})
