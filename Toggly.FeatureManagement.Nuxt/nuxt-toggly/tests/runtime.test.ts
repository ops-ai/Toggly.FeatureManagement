import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: {} as any, server: vi.fn(), create: vi.fn(), init: vi.fn() }))
vi.mock('#app', () => ({ defineNuxtPlugin: (fn: unknown) => fn, useRuntimeConfig: () => ({ public: { toggly: mocks.config } }) }))
vi.mock('#imports', () => ({ defineNitroPlugin: (fn: unknown) => fn, useRuntimeConfig: () => ({ public: { toggly: mocks.config } }) }))
vi.mock('#toggly/on-error', () => ({ default: undefined }))
vi.mock('@ops-ai/nuxt-toggly-server', () => ({ initServerToggly: mocks.server }))
vi.mock('@ops-ai/nuxt-toggly-client', () => ({ createToggly: mocks.create, provideToggly: vi.fn(), vFeature: {}, vFeatureShow: {}, vFeatureClass: {} }))
import clientPlugin from '../src/runtime/plugin.client'
import serverPlugin from '../src/runtime/plugin.server'
import { createToggly } from '../../nuxt-toggly-client/src/composables/useToggly'

const app = () => ({ vueApp: { provide: vi.fn(), directive: vi.fn() } })
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
    await (serverPlugin as any)()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining(context))
    expect(mocks.server).toHaveBeenCalledWith(expect.objectContaining(context))
    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.server).toHaveBeenCalledTimes(1)
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
    await (serverPlugin as any)()
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
    await (serverPlugin as any)()
    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.server).not.toHaveBeenCalled()
    expect(nuxt.vueApp.directive).not.toHaveBeenCalled()
  })

  it.each([true, false])('handles success and failure logging, debug=%s', async debug => {
    mocks.config.debug = debug
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await (clientPlugin as any)(app())
    await (serverPlugin as any)()
    mocks.init.mockRejectedValue(new Error('offline'))
    mocks.server.mockRejectedValue(new Error('offline'))
    await (clientPlugin as any)(app())
    await (serverPlugin as any)()
    expect(console.error).toHaveBeenCalledTimes(debug ? 2 : 0)
  })
})
