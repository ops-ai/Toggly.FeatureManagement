import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel } from '@ops-ai/nuxt-toggly-core'
import {
  defineFeatureMiddleware,
  defineFeatureHandler,
  defineTogglyContextMiddleware,
  useEventToggly,
  getEventToggly,
  isEventFeatureOn,
  isEventFeatureOff,
  evaluateEventFeatureGate,
} from '../src/middleware'
import {
  configureEventEvalContext,
  resetEventEvalContextProviders,
  resolveEventEvalContext,
  getCachedEventEvalContext,
} from '../src/event-context'
import {
  initServerToggly,
  resetServerToggly,
  getServerToggly,
} from '../src/server-client'
import type { H3Event } from 'h3'
import type { TogglyClient } from '@ops-ai/nuxt-toggly-core'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function featureDefs(flags: Record<string, boolean>) {
  return Object.entries(flags).map(([featureKey, enabled]) => ({
    featureKey,
    filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }],
  }))
}

function createMockResponse(data: unknown, status = 200) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => data,
    headers: { get: () => null },
  }
}

function createMockEvent(headers: Record<string, string> = {}): H3Event {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value
  }
  return {
    node: {
      req: {
        headers: normalized,
      },
    },
    context: {},
  } as unknown as H3Event
}

const targetingAlice: FeatureDefinitionModel = {
  featureKey: 'targeted-flag',
  filters: [
    {
      name: 'Targeting',
      parameters: {
        'Audience.Users:0': 'alice',
        'Audience.DefaultRolloutPercentage': 0,
      },
    },
  ],
}

const claimsFlag: FeatureDefinitionModel = {
  featureKey: 'claims-flag',
  filters: [
    {
      name: 'UserClaims',
      parameters: { Percentage: 100, Claim: 'role', Value: 'admin' },
    },
  ],
}

const countryFlag: FeatureDefinitionModel = {
  featureKey: 'country-flag',
  filters: [
    {
      name: 'Country',
      parameters: { Percentage: 100, 'Country:0': 'US' },
    },
  ],
}

const groupsFlag: FeatureDefinitionModel = {
  featureKey: 'groups-flag',
  filters: [
    {
      name: 'Targeting',
      parameters: {
        'Audience.Groups:0': 'beta',
        'Audience.DefaultRolloutPercentage': 0,
      },
    },
  ],
}

// Mock h3 functions
vi.mock('h3', () => ({
  createError: (options: {
    statusCode: number
    message: string
    statusMessage: string
  }) => {
    const error = new Error(options.message) as Error & {
      statusCode: number
      statusMessage: string
    }
    error.statusCode = options.statusCode
    error.statusMessage = options.statusMessage
    return error
  },
  defineEventHandler: (handler: (event: H3Event) => unknown) => handler,
  getHeader: (event: H3Event, header: string) => {
    const headers = (event.node?.req?.headers || {}) as Record<string, string>
    return headers[header.toLowerCase()]
  },
  getRequestHeaders: (event: H3Event) => {
    return (event.node?.req?.headers || {}) as Record<string, string>
  },
  setResponseStatus: vi.fn(),
}))

describe('Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServerToggly()
    resetEventEvalContextProviders()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
    resetEventEvalContextProviders()
  })

  describe('defineFeatureMiddleware', () => {
    it('should allow access when feature is enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
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
        createMockResponse(featureDefs({ 'feature-a': false }))
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
        createMockResponse(featureDefs({ 'feature-a': false }))
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
        createMockResponse(featureDefs({ 'feature-a': true, 'feature-b': true }))
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
        createMockResponse(featureDefs({ 'feature-a': true, 'feature-b': false }))
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const middleware = defineFeatureMiddleware({
        featureKey: ['feature-a', 'feature-b'],
        requirement: 'any',
      })

      const event = createMockEvent()

      await expect(middleware(event)).resolves.not.toThrow()
    })

    it('should use identity from header without mutating shared client', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({
        appKey: 'test-key',
        identity: 'default-user',
        enableLiveUpdates: false,
      })

      const middleware = defineFeatureMiddleware({
        featureKey: 'feature-a',
      })

      const event = createMockEvent({
        'x-toggly-identity': 'user-123',
      })

      await middleware(event)

      expect(getServerToggly()?.identity).toBe('default-user')
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
        createMockResponse(featureDefs({ 'feature-a': true }))
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
        createMockResponse(featureDefs({ 'feature-a': false }))
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

    it('should call onDisabled when feature is disabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': false }))
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const onDisabled = vi.fn()
      const handler = vi.fn()
      const wrappedHandler = defineFeatureHandler('feature-a', handler, {
        onDisabled,
      })

      await expect(wrappedHandler(createMockEvent())).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(onDisabled).toHaveBeenCalled()
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
    it('should return client with identity from header without mutating shared', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(featureDefs({})))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'default-user',
        enableLiveUpdates: false,
      })

      const event = createMockEvent({
        'x-toggly-identity': 'user-123',
      })

      const client = useEventToggly(event)

      expect(client.identity).toBe('user-123')
      expect(getServerToggly()?.identity).toBe('default-user')
    })

    it('should proxy eval helpers and ignore identity writes', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          {
            featureKey: 'targeted-flag',
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
          {
            featureKey: 'plain-on',
            filters: [{ name: 'AlwaysOn', parameters: {} }],
          },
        ])
      )

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      const event = createMockEvent({
        'x-toggly-identity': 'alice',
      })
      const client = useEventToggly(event)

      expect(await client.isFeatureOn('targeted-flag')).toBe(true)
      expect(await client.isFeatureOff('targeted-flag')).toBe(false)
      expect(await client.evaluateFeatureGate(['targeted-flag', 'plain-on'], 'all')).toBe(
        true,
      )

      client.identity = 'evil'
      expect(getServerToggly()?.identity).toBe('bob')
      expect(client.identity).toBe('alice')

      // Non-identity writes still forward to the shared client
      ;(client as TogglyClient & { __probe?: number }).__probe = 42
      expect((getServerToggly() as TogglyClient & { __probe?: number })?.__probe).toBe(
        42,
      )
    })

    it('falls back to shared client identity when no identity header', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(featureDefs({})))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'default-user',
        enableLiveUpdates: false,
      })

      const client = useEventToggly(createMockEvent())
      expect(client.identity).toBe('default-user')
      expect(getServerToggly()?.identity).toBe('default-user')
    })

    it('should throw if client not initialized', () => {
      const event = createMockEvent()

      expect(() => useEventToggly(event)).toThrow(
        '[Toggly] Server client not initialized'
      )
    })
  })

  describe('ambient EvalContext', () => {
    it('binds claims, groups, and country from providers without per-call props', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([
          targetingAlice,
          claimsFlag,
          countryFlag,
          groupsFlag,
        ])
      )

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      configureEventEvalContext({
        getIdentity: () => 'alice',
        getGroups: () => ['beta'],
        getClaims: () => ({ role: 'admin' }),
      })

      const event = createMockEvent({
        'cf-ipcountry': 'US',
      })

      expect(await isEventFeatureOn(event, 'targeted-flag')).toBe(true)
      expect(await isEventFeatureOn(event, 'claims-flag')).toBe(true)
      expect(await isEventFeatureOn(event, 'country-flag')).toBe(true)
      expect(await isEventFeatureOn(event, 'groups-flag')).toBe(true)
      expect(getServerToggly()?.identity).toBe('bob')
    })

    it('fills request.country from cf-ipcountry when getContext omits request', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([countryFlag]))

      await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })

      configureEventEvalContext({
        getContext: () => ({
          identity: 'alice',
          claims: { role: 'admin' },
        }),
      })

      const event = createMockEvent({ 'cf-ipcountry': 'US' })
      expect(await isEventFeatureOn(event, 'country-flag')).toBe(true)
      const cached = getCachedEventEvalContext(event)
      expect(cached?.request?.country).toBe('US')
      expect(cached?.identity).toBe('alice')
    })

    it('fills request.country when getContext returns empty request object', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([countryFlag]))

      await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })

      configureEventEvalContext({
        getContext: () => ({
          identity: 'alice',
          request: {},
        }),
      })

      const event = createMockEvent({ 'cf-ipcountry': 'US' })
      expect(await isEventFeatureOn(event, 'country-flag')).toBe(true)
      expect(getCachedEventEvalContext(event)?.request?.country).toBe('US')
    })

    it('lets per-call options override ambient field-by-field', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([targetingAlice, claimsFlag])
      )

      await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })

      configureEventEvalContext({
        getIdentity: () => 'alice',
        getClaims: () => ({ role: 'admin' }),
      })

      const event = createMockEvent()

      expect(await isEventFeatureOn(event, 'targeted-flag')).toBe(true)
      expect(
        await isEventFeatureOn(event, 'targeted-flag', { identity: 'bob' })
      ).toBe(false)
      // claims still ambient when only identity overridden
      expect(
        await isEventFeatureOn(event, 'claims-flag', { identity: 'bob' })
      ).toBe(true)
      expect(
        await isEventFeatureOn(event, 'claims-flag', {
          claims: { role: 'user' },
        })
      ).toBe(false)
    })

    it('isolates concurrent events without mutating shared identity', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([targetingAlice]))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'shared',
        enableLiveUpdates: false,
      })

      configureEventEvalContext({
        getIdentity: (event) =>
          (event.node?.req?.headers as Record<string, string>)[
            'x-toggly-identity'
          ],
      })

      const [left, right] = await Promise.all([
        isEventFeatureOn(
          createMockEvent({ 'x-toggly-identity': 'alice' }),
          'targeted-flag'
        ),
        isEventFeatureOn(
          createMockEvent({ 'x-toggly-identity': 'bob' }),
          'targeted-flag'
        ),
      ])

      expect(left).toBe(true)
      expect(right).toBe(false)
      expect(getServerToggly()?.identity).toBe('shared')
    })

    it('defineTogglyContextMiddleware caches ambient for useEventToggly', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([targetingAlice, claimsFlag, countryFlag])
      )

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      const middleware = defineTogglyContextMiddleware({
        getIdentity: () => 'alice',
        getClaims: () => ({ role: 'admin' }),
      })

      const event = createMockEvent({ 'cf-ipcountry': 'US' })
      await middleware(event)

      expect(getCachedEventEvalContext(event)?.identity).toBe('alice')

      const client = useEventToggly(event)
      expect(await client.isFeatureOn('targeted-flag')).toBe(true)
      expect(await client.isFeatureOn('claims-flag')).toBe(true)
      expect(await client.isFeatureOn('country-flag')).toBe(true)
      expect(getServerToggly()?.identity).toBe('bob')
    })

    it('getEventToggly resolves providers then binds', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([targetingAlice]))

      await initServerToggly({
        appKey: 'test-key',
        identity: 'bob',
        enableLiveUpdates: false,
      })

      configureEventEvalContext({
        getIdentity: async () => 'alice',
      })

      const client = await getEventToggly(createMockEvent())
      expect(await client.isFeatureOn('targeted-flag')).toBe(true)
      expect(getServerToggly()?.identity).toBe('bob')
    })

    it('proxy per-call EvalContextArg overrides win field-by-field', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse([targetingAlice, claimsFlag])
      )

      await initServerToggly({
        appKey: 'test-key',
        enableLiveUpdates: false,
      })

      const event = createMockEvent()
      await resolveEventEvalContext(event, {
        getIdentity: () => 'alice',
        getClaims: () => ({ role: 'admin' }),
      })

      const client = useEventToggly(event)
      expect(await client.isFeatureOn('targeted-flag')).toBe(true)
      expect(
        await client.isFeatureOn('targeted-flag', undefined, undefined, {
          identity: 'bob',
        })
      ).toBe(false)
      expect(
        await client.isFeatureOn('claims-flag', undefined, undefined, {
          identity: 'bob',
        })
      ).toBe(true)
    })
  })

  describe('isEventFeatureOn', () => {
    it('should check feature for event', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(await isEventFeatureOn(event, 'feature-a')).toBe(true)
    })

    it('should use identity from header without mutating shared client', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({
        appKey: 'test-key',
        identity: 'default-user',
        enableLiveUpdates: false,
      })

      const event = createMockEvent({
        'x-toggly-identity': 'user-123',
      })

      await isEventFeatureOn(event, 'feature-a')

      expect(getServerToggly()?.identity).toBe('default-user')
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
        createMockResponse(featureDefs({ 'feature-a': true }))
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(await isEventFeatureOff(event, 'feature-a')).toBe(false)
    })
  })

  describe('evaluateEventFeatureGate', () => {
    it('should evaluate multiple features', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true, 'feature-b': true }))
      )

      await initServerToggly({ appKey: 'test-key', enableLiveUpdates: false })

      const event = createMockEvent()

      expect(
        await evaluateEventFeatureGate(event, ['feature-a', 'feature-b'], 'all')
      ).toBe(true)
    })

    it('should support negate option', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(featureDefs({ 'feature-a': true }))
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
