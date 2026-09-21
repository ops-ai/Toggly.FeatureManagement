import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToggly, resetToggly } from '../src/composables/useToggly'
import { gunzipSync } from 'node:zlib'
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { TOGGLY_INJECTION_KEY } from '../src/types'
import { useFeatureFlag } from '../src/composables/useFeatureFlag'
import { useFeatureGate } from '../src/composables/useFeatureGate'
import { vFeature, vFeatureShow, vFeatureClass } from '../src/directives/vFeature'

async function payloadFrom(init?: RequestInit): Promise<any> {
  const body = init?.body
  const bytes = typeof body === 'string'
    ? Buffer.from(body)
    : Buffer.from(await new Response(body).arrayBuffer())
  const encoding = new Headers(init?.headers).get('Content-Encoding')
  return JSON.parse((encoding === 'gzip' ? gunzipSync(bytes) : bytes).toString())
}

describe('browser telemetry facade', () => {
  beforeEach(() => {
    localStorage.clear()
    process.env.TOGGLY_DISABLE_TELEMETRY = '0'
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | URL | Request) => {
      if (String(input).includes('/api/frontend/telemetry')) return new Response('', { status: 202 })
      return new Response(JSON.stringify({ Flag: true }))
    }))
  })

  afterEach(() => {
    resetToggly()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    process.env.TOGGLY_DISABLE_TELEMETRY = '1'
  })

  it('exposes compact explicit APIs and emits only compact payload fields', async () => {
    const toggly = createToggly({
      appKey: 'app',
      environment: 'Test',
      metricsBaseUrl: 'https://collector.example',
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    await toggly.init()

    await toggly.isFeatureOn('Flag')
    toggly.telemetry.recordUsage('Flag', 'blue')
    toggly.telemetry.recordView('Flag', 'green')
    toggly.telemetry.incrementCounter('clicks', 2)
    toggly.telemetry.setGauge('depth', 3)
    await toggly.telemetry.flushTelemetry()

    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/frontend/telemetry'))
    expect(calls).toHaveLength(1)
    const json = await payloadFrom(calls[0][1])
    expect(Object.keys(json).sort()).toEqual(['e', 'f', 'k', 'm', 'u'])
    expect(json.u).toBe(toggly.identity.value)
    expect(JSON.stringify(json)).not.toContain('identity')
    expect(json.f.Flag.enabled).toEqual([1])
    expect(json.f.Flag.blue).toEqual([0, 1])
    expect(json.f.Flag.green).toEqual([0, 0, 1])
  })

  it('disposes the old browser owner when createToggly replaces it', async () => {
    const first = createToggly({ appKey: 'old', refreshInterval: 0, enableLiveUpdates: false })
    await first.init()
    first.telemetry.incrementCounter('old-count')

    const second = createToggly({ appKey: 'new', refreshInterval: 0, enableLiveUpdates: false })
    await second.init()
    second.telemetry.incrementCounter('new-count')
    await second.telemetry.flushTelemetry()

    first.telemetry.incrementCounter('stale-count')
    await first.telemetry.flushTelemetry()
    const payloads = await Promise.all(vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url).includes('/api/frontend/telemetry'))
      .map(async ([, init]) => payloadFrom(init)))
    expect(payloads.some(payload => payload.k === 'new' && payload.m?.['new-count'] === 1)).toBe(true)
    expect(JSON.stringify(payloads)).not.toContain('stale-count')
  })

  it('keeps unsupported legacy measurements payload-free with bounded diagnostics', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const toggly = createToggly({ appKey: 'app', refreshInterval: 0, enableLiveUpdates: false })
    await toggly.init()

    for (let index = 0; index < 12; index++) {
      toggly.client.measure('latency', index, { feature: 'Flag' })
      toggly.client.observe('duration', index, { variant: 'blue' })
    }
    await toggly.telemetry.flushTelemetry()

    expect(warn).toHaveBeenCalledTimes(10)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('browser measure() is unsupported'))
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/frontend/telemetry'))).toHaveLength(0)
  })

  it('counts one consumer evaluation after cold initialization without counting hydration projections', async () => {
    let resolveDefinitions!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: string | URL | Request) => {
      if (String(input).includes('/api/frontend/telemetry')) return Promise.resolve(new Response('', { status: 202 }))
      return new Promise<Response>(resolve => { resolveDefinitions = resolve })
    }))
    const toggly = createToggly({ appKey: 'app', refreshInterval: 0, enableLiveUpdates: false })
    const component = defineComponent({
      setup() {
        const flag = useFeatureFlag('Flag')
        return () => h('div', String(flag.isEnabled.value))
      },
    })
    const wrapper = mount(component, { global: { provide: { [TOGGLY_INJECTION_KEY as symbol]: toggly } } })
    const initialized = toggly.init()
    resolveDefinitions(new Response(JSON.stringify({ Flag: true })))
    await initialized
    await nextTick()
    await toggly.telemetry.flushTelemetry()

    const telemetryCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/api/frontend/telemetry'))
    const payload = await payloadFrom(telemetryCall?.[1])
    expect(payload.f.Flag.enabled).toEqual([1])
    wrapper.unmount()
  })

  it('counts one evaluation when a component mounts after initialization', async () => {
    const toggly = createToggly({ appKey: 'app', refreshInterval: 0, enableLiveUpdates: false })
    await toggly.init()
    const component = defineComponent({
      setup() {
        const flag = useFeatureFlag('Flag')
        return () => h('div', String(flag.isEnabled.value))
      },
    })
    const wrapper = mount(component, { global: { provide: { [TOGGLY_INJECTION_KEY as symbol]: toggly } } })
    await nextTick()
    await toggly.telemetry.flushTelemetry()

    const telemetryCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/api/frontend/telemetry'))
    const payload = await payloadFrom(telemetryCall?.[1])
    expect(payload.f.Flag.enabled).toEqual([1])
    wrapper.unmount()
  })

  it.each([
    { options: { enableTelemetry: false }, usage: false, metrics: false },
    { options: { enableUsageTracking: false }, usage: false, metrics: true },
    { options: { enableMetrics: false }, usage: true, metrics: false },
  ])('respects independent browser category opt-outs: %j', async ({ options, usage, metrics }) => {
    const toggly = createToggly({
      appKey: 'app',
      refreshInterval: 0,
      enableLiveUpdates: false,
      ...options,
    })
    await toggly.init()
    toggly.telemetry.recordUsage('Flag')
    toggly.telemetry.incrementCounter('clicks')
    await toggly.telemetry.flushTelemetry()
    const telemetryCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/frontend/telemetry'))
    if (!usage && !metrics) expect(telemetryCalls).toHaveLength(0)
    else {
      const payload = await payloadFrom(telemetryCalls.at(-1)?.[1])
      expect(Boolean(payload.f)).toBe(usage)
      expect(Boolean(payload.m)).toBe(metrics)
    }
  })
  it('forwards minted targeting, rotates attribution, and keeps legacy identity separate', async () => {
    const toggly = createToggly({appKey: 'app', identity: 'alice', instanceId: 'mint-a', groups: ['staff'], claims: {role: 'admin'}, refreshInterval: 0, enableLiveUpdates: false})
    await toggly.init()
    const query = new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams
    expect(query.get('i')).toBe('mint-a')
    for (const key of ['u', 'userId', 'g', 'claim.role']) expect(query.has(key)).toBe(false)
    toggly.telemetry.setGauge('cart', 1)
    await toggly.setContext({instanceId: 'mint-b'}); toggly.telemetry.setGauge('cart', 2)
    await toggly.setIdentity('bob'); toggly.client.recordUsage('Flag', 'legacy-identity', 'blue')
    await toggly.setContext({identity: ''}); toggly.telemetry.setGauge('cart', 3)
    await toggly.telemetry.flushTelemetry()
    const payloads = await Promise.all(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/frontend/telemetry')).map(([,init]) => payloadFrom(init)))
    expect(payloads.map(body => [body.i,body.u])).toEqual([['mint-a',undefined],['mint-b',undefined],[undefined,'bob'],[undefined,undefined]])
    expect(payloads[2].f.Flag.blue).toEqual([0,1])
    expect(JSON.stringify(payloads)).not.toContain('legacy-identity')
  })

  it('hydrates token A-B-A persisted revisions only with matching response bodies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({Flag: true}), {headers: {etag: 'revision-a'}}))
    const toggly = createToggly({appKey: 'app', instanceId: 'mint-a', persistFeatures: true, refreshInterval: 0, enableLiveUpdates: false})
    await toggly.init()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({Flag: false}), {headers: {etag: 'revision-b'}}))
    await toggly.setContext({instanceId: 'mint-b'})
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, {status: 304}))
    await toggly.setContext({instanceId: 'mint-a'})
    expect(toggly.features.value.Flag).toBe(true)
    const call = vi.mocked(fetch).mock.calls.at(-1)!
    expect(new Headers(call[1]?.headers).get('If-None-Match')).toBe('revision-a')
    expect(new URL(String(call[0])).searchParams.get('i')).toBe('mint-a')
  })

  it('keeps captured flags and attribution when hooks or local gates change identity', async () => {
    const toggly = createToggly({appKey: 'app', identity: 'alice', refreshInterval: 0, enableLiveUpdates: false})
    await toggly.init()
    toggly.client.addHook({getMetadata: () => ({name: 'reenter'}), beforeEvaluation: async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({Flag: false})))
      await toggly.setIdentity('bob')
    }})
    expect(await toggly.isFeatureOn('Flag')).toBe(true)
    toggly.client.removeHook('reenter')
    await toggly.telemetry.flushTelemetry()
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/frontend/telemetry'))
    expect((await payloadFrom(calls[0][1])).u).toBe('alice')
  })

  it('rejects a failed identity refresh without restoring the old token or definitions', async () => {
    const toggly = createToggly({appKey: 'app', identity: 'alice', instanceId: 'mint-a', featureDefaults: {Safe: true}, refreshInterval: 0, enableLiveUpdates: false})
    await toggly.init()
    vi.mocked(fetch).mockRejectedValueOnce(Error('refresh failed'))
    await expect(toggly.setIdentity('bob')).rejects.toThrow('refresh failed')
    expect(toggly.identity.value).toBe('bob')
    expect(toggly.client.config.instanceId).toBeUndefined()
    expect(toggly.features.value).toEqual({Safe: true})
  })

  it('rejects old HTTP bodies across identity ABA and destruction', async () => {
    const toggly = createToggly({appKey: 'app', identity: 'alice', refreshInterval: 0, enableLiveUpdates: false})
    await toggly.init()
    const pending: ((value: Response) => void)[] = []
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const a = toggly.setIdentity('alice'); await new Promise(resolve => setTimeout(resolve, 0))
    const b = toggly.setIdentity('bob'); await new Promise(resolve => setTimeout(resolve, 0))
    const c = toggly.setIdentity('alice'); await new Promise(resolve => setTimeout(resolve, 0))
    expect(pending).toHaveLength(3)
    pending[2](new Response(JSON.stringify({Current: true}))); await c
    pending[0](new Response(JSON.stringify({Stale: true}))); pending[1](new Response(JSON.stringify({Stale: true}))); await Promise.all([a,b])
    expect(toggly.client.state.features).toEqual({Current: true})
    const d = toggly.refresh(); toggly.client.destroy(); pending[3](new Response(JSON.stringify({Resurrected: true}))); await d
    expect(toggly.client.state.features).toEqual({Current: true})
  })

  it('preserves queued routes on same transport and discards only a replaced transport', async () => {
    const sent: any[] = [], replacement: any[] = []
    const transport = vi.fn(async (_url: any, init: any) => {sent.push(await payloadFrom(init)); return {status: 202}})
    const next = vi.fn(async (_url: any, init: any) => {replacement.push(await payloadFrom(init)); return {status: 202}})
    const owner = createToggly({appKey: 'a', identity: 'alice', telemetryFetch: transport as any, refreshInterval: 0, enableLiveUpdates: false})
    await owner.init(); owner.telemetry.incrementCounter('old-route')
    await owner.init({appKey: 'b', environment: 'Staging'}); owner.telemetry.incrementCounter('new-route')
    await owner.telemetry.flushTelemetry()
    expect(sent.map(body => [body.k,body.e])).toEqual([['a','Production'],['b','Staging']])
    owner.telemetry.incrementCounter('discarded')
    await owner.init({telemetryFetch: next as any}); owner.telemetry.incrementCounter('replacement')
    await owner.telemetry.flushTelemetry()
    expect(sent).toHaveLength(2)
    expect(replacement).toEqual([{k:'b',e:'Staging',u:'alice',m:{replacement:1}}])
  })

  it('survives denied storage while keeping identity and definitions in memory', async () => {
    const getter = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    Object.defineProperty(globalThis, 'localStorage', {configurable:true, get(){throw new DOMException('denied','SecurityError')}})
    try {
      const owner = createToggly({appKey:'denied',instanceId:'mint',persistFeatures:true,refreshInterval:0,enableLiveUpdates:false})
      await owner.init(); expect(await owner.isFeatureOn('Flag')).toBe(true)
      await owner.setIdentity('bob'); expect(owner.identity.value).toBe('bob')
    } finally {Object.defineProperty(globalThis,'localStorage',getter)}
  })

  it.each(['flag','gate'])('keeps refreshed projection after a pending %s hook without counting refresh', async kind => {
    const owner = createToggly({appKey:'projection',instanceId:'mint',refreshInterval:0,enableLiveUpdates:false})
    await owner.init()
    let release!:()=>void
    owner.client.addHook({getMetadata:()=>({name:'pending'}), beforeEvaluation:()=>new Promise<void>(resolve=>{release=resolve})})
    const wrapper=mount(defineComponent({setup(){const state=kind==='flag'?useFeatureFlag('Flag'):useFeatureGate(['Flag']);return()=>h('span',String(state.isEnabled.value))}}), {global:{provide:{[TOGGLY_INJECTION_KEY as symbol]:owner}}})
    try {
      await flushPromises()
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({Flag:false})))
      await owner.refresh(); await flushPromises(); expect(wrapper.text()).toBe('false')
      release(); await flushPromises(); expect(wrapper.text()).toBe('false')
      await owner.telemetry.flushTelemetry()
      const packets=await Promise.all(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/api/frontend/telemetry')).map(([,init])=>payloadFrom(init)))
      expect(packets).toEqual([{k:'projection',e:'Production',i:'mint',f:{Flag:{enabled:[1]}}}])
    } finally {release?.();wrapper.unmount()}
  })

  it.each([['display',vFeature],['visibility',vFeatureShow],['class',vFeatureClass]] as const)('counts actual %s directive recomputation while fencing the superseded result', async (kind,directive) => {
    const owner=createToggly({appKey:'directive',instanceId:'mint',refreshInterval:0,enableLiveUpdates:false})
    await owner.init()
    let release!:()=>void
    let first = true
    owner.client.addHook({getMetadata:()=>({name:'pending'}),beforeEvaluation:()=>{if(first){first=false;return new Promise<void>(resolve=>{release=resolve})}}})
    const element=document.createElement('div')
    const binding={value:'Flag',modifiers:{},arg:'enabled'} as any
    ;(directive.mounted as any)(element,binding)
    await flushPromises()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({Flag:false})))
    await owner.refresh();await flushPromises()
    release();await flushPromises()
    expect(kind==='display'?element.style.display:kind==='visibility'?element.style.visibility:element.classList.contains('enabled')).toBe(kind==='display'?'none':kind==='visibility'?'hidden':false)
    ;(directive.beforeUnmount as any)(element)
    await owner.telemetry.flushTelemetry()
    const packets=await Promise.all(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/api/frontend/telemetry')).map(([,init])=>payloadFrom(init)))
    expect(packets).toEqual([{k:'directive',e:'Production',i:'mint',f:{Flag:{enabled:[1],disabled:[1]}}}])
  })

  // Exercises the shared owner budget through the real public transition path.
  it('retains one bounded queue across 2200 context rotations', async () => {
    vi.stubGlobal('CompressionStream',undefined)
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
    const owner=createToggly({appKey:'budget',identity:'first',refreshInterval:0,enableLiveUpdates:false})
    // Before init, context changes do not fetch definitions; the first init creates the owner.
    await owner.init()
    for(let index=0;index<2200;index++) {owner.client.identity=`context-${index}`;owner.telemetry.incrementCounter('orders')}
    await owner.telemetry.flushTelemetry()
    const packets=await Promise.all(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/api/frontend/telemetry')).map(([,init])=>payloadFrom(init)))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('buffer-full'))
    expect(packets.length).toBeGreaterThan(0);expect(packets.length).toBeLessThanOrEqual(2000)
    expect(packets.reduce((bytes,body)=>bytes+Buffer.byteLength(JSON.stringify(body)),0)).toBeLessThanOrEqual(262144)
    expect(new Set(packets.map(body=>body.u)).size).toBe(packets.length)
    expect(packets.every(body=>body.m.orders===1)).toBe(true)
  },15000)

})
