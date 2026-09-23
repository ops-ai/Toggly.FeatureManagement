import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: {} as any, server: vi.fn(), create: vi.fn(), init: vi.fn() }))
vi.mock('#app', () => ({ defineNuxtPlugin: (fn: unknown) => fn, useRuntimeConfig: () => ({ public: { toggly: mocks.config } }) }))
vi.mock('#imports', () => ({ defineNitroPlugin: (fn: unknown) => fn, useRuntimeConfig: () => ({ public: { toggly: mocks.config } }) }))
vi.mock('#toggly/on-error', () => ({ default: undefined }))
vi.mock('@ops-ai/nuxt-toggly-server', () => ({ initServerToggly: mocks.server, closeServerToggly: vi.fn() }))
vi.mock('@ops-ai/nuxt-toggly-client', () => ({ createToggly: mocks.create, TOGGLY_INJECTION_KEY: Symbol('toggly'), vFeature: {}, vFeatureShow: {}, vFeatureClass: {} }))
import clientPlugin from '../src/runtime/plugin.client'
import serverPlugin from '../src/runtime/plugin.server'
import { createToggly } from '../../nuxt-toggly-client/src/composables/useToggly'

const app = () => ({ payload: {}, hook: vi.fn(), vueApp: { provide: vi.fn(), directive: vi.fn() } })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.config = { appKey: 'app', identity: 'user&123', refreshInterval: 0, enableLiveUpdates: false, persistIdentity: false }
  mocks.init.mockResolvedValue({})
  mocks.server.mockResolvedValue({})
  mocks.create.mockImplementation(() => ({ init: mocks.init, features: { value: {} } }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('startup context forwarding', () => {
  it.each([
    { groups: ['beta', 'team a'], claims: { plan: 'pro&plus' } },
    { groups: [], claims: {} },
    { groups: undefined, claims: undefined },
  ])('forwards configured defaults before initialization: %j', async context => {
    Object.assign(mocks.config, context)
    await (clientPlugin as any)(app())
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining(context))
    expect(mocks.server).toHaveBeenCalledWith(expect.objectContaining(context))
    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.server).toHaveBeenCalledTimes(1)
  })

  it('forwards enableVariants to both the client and server owners', async () => {
    Object.assign(mocks.config, { enableVariants: true })
    await (clientPlugin as any)(app())
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ enableVariants: true }))
    expect(mocks.server).toHaveBeenCalledWith(expect.objectContaining({ enableVariants: true }))
  })

  it('forwards browser telemetry configuration only to the client owner', async () => {
    Object.assign(mocks.config, {
      enableTelemetry: false,
      enableUsageTracking: false,
      enableMetrics: true,
      metricsBaseUrl: 'https://collector.example',
      telemetryFlushIntervalMs: 30000,
    })
    await (clientPlugin as any)(app())
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      enableTelemetry: false,
      enableUsageTracking: false,
      enableMetrics: true,
      metricsBaseUrl: 'https://collector.example',
      telemetryFlushIntervalMs: 30000,
    }))
    expect(mocks.server).not.toHaveBeenCalledWith(expect.objectContaining({
      metricsBaseUrl: 'https://collector.example',
    }))
  })

  it.each([
    { serverEnableUsageTracking: false, serverEnableMetrics: false },
    { serverEnableUsageTracking: true, serverEnableMetrics: false },
    { serverEnableUsageTracking: false, serverEnableMetrics: true },
    { serverEnableUsageTracking: undefined, serverEnableMetrics: undefined },
  ])('keeps Nitro policy independent of browser categories: %j', async policy => {
    Object.assign(mocks.config, { enableUsageTracking: true, enableMetrics: true, ...policy })
    await (clientPlugin as any)(app())
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(mocks.server.mock.calls[0][0]).toMatchObject({
      enableUsageTracking: policy.serverEnableUsageTracking,
      enableMetrics: policy.serverEnableMetrics,
    })
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ enableUsageTracking: true, enableMetrics: true })
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('serverEnableUsageTracking')
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('serverEnableMetrics')
  })

  it('forwards minted context and withholds an unrelated SSR identity snapshot', async () => {
    mocks.config.instanceId = 'minted'
    const hydrate = vi.fn()
    mocks.create.mockImplementation(() => ({init:mocks.init,features:{value:{}},client:{hydrateEvaluatedFeatures:hydrate},isReady:{value:false}}))
    const nuxt = {...app(),payload:{toggly:{features:{Foreign:true},identity:'ssr-user'}}}
    await (clientPlugin as any)(nuxt)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({instanceId:'minted'}))
    expect(hydrate).not.toHaveBeenCalled()
    await nuxt.hook.mock.calls.find(([name])=>name==='app:mounted')![1]()
    expect(mocks.init).toHaveBeenCalledTimes(1)
  })

  it('snapshots caller collections before initialization can yield', async () => {
    const groups = ['beta']
    const claims = { plan: 'pro' }
    Object.assign(mocks.config, { groups, claims })
    mocks.init.mockImplementation(async () => { groups.push('mutated'); claims.plan = 'changed' })
    await (clientPlugin as any)(app())
    expect(mocks.create.mock.calls[0][0]).toEqual(expect.objectContaining({ groups: ['beta'], claims: { plan: 'pro' } }))
    groups.splice(1)
    claims.plan = 'pro'
    mocks.server.mockImplementation(async () => { groups.push('mutated'); claims.plan = 'changed' })
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(mocks.server.mock.calls[0][0]).toEqual(expect.objectContaining({ groups: ['beta'], claims: { plan: 'pro' } }))
  })

  it('sends all startup context in exactly one real wrapper/core evaluated request', async () => {
    Object.assign(mocks.config, { groups: ['beta', 'team a'], claims: { plan: 'pro&plus' } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Test: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    let instance: ReturnType<typeof createToggly>
    mocks.create.mockImplementation(config => (instance = createToggly(config)))
    try {
      await (clientPlugin as any)(app())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = new URL(fetchMock.mock.calls[0][0])
      expect(url.searchParams.get('u')).toBe('user&123')
      expect(url.searchParams.getAll('g')).toEqual(['beta', 'team a'])
      expect(url.searchParams.get('claim.plan')).toBe('pro&plus')
    } finally { instance!.client.destroy() }
  })

  it.each([true, false])('supports disabled startup and directives, debug=%s', async debug => {
    mocks.config = { debug, globalDirectives: false }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nuxt = app()
    await (clientPlugin as any)(nuxt)
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.server).not.toHaveBeenCalled()
    expect(nuxt.vueApp.directive).not.toHaveBeenCalled()
  })

  it.each([true, false])('handles success and failure logging, debug=%s', async debug => {
    mocks.config.debug = debug
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await (clientPlugin as any)(app())
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    mocks.init.mockRejectedValue(new Error('offline'))
    mocks.server.mockRejectedValue(new Error('offline'))
    await (clientPlugin as any)(app())
    await (serverPlugin as any)({ hooks: { hook: vi.fn() } })
    expect(console.error).toHaveBeenCalledTimes(debug ? 2 : 0)
  })
})
