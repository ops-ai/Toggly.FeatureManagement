import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, inject, markRaw, nextTick, shallowRef, watch } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { Toggly, type TogglyOptions } from '../plugins/toggly.service'
import plugin from '../plugins/toggly'
import { useFeatureGate, useFeatureFlag } from '../composables/useFeatureGate'
import { useVariant } from '../composables/useVariant'
import Feature from '../components/Feature.vue'
import FeatureGateBuilder from '../components/FeatureGateBuilder.vue'

const response = (defs: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(defs) })
describe('Vue frontend telemetry', () => {
  let clients: Toggly[]
  let sent: {url: string; body: any; init: RequestInit}[]
  let definitions: Record<string, unknown>
  let fetchMock: ReturnType<typeof vi.fn>
  const cleanups: (() => void)[] = []
  function client(options: TogglyOptions = {}) {
    const service = new Toggly().init({ appKey: 'test', environment: 'Test', enableLiveUpdates: false, persistCache: false, ...options })
    clients.push(service)
    return markRaw(service)
  }
  beforeEach(() => {
    clients = []; sent = []; definitions = {On: true, Off: false}; localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('CompressionStream', undefined)
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/frontend/telemetry')) {
        sent.push({url, init: init!, body: JSON.parse(init!.body as string)})
        return {status: 202}
      }
      return response(definitions)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(async () => {
    cleanups.splice(0).forEach(cleanup => cleanup())
    clients.forEach(service => service.dispose?.()); await flushPromises()
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  it('preserves canonical UTF-16 group cache bytes across permutations without mutating inputs', () => {
    const groups = ['ä', '2', 'A', '😀', 'a', '10', 'Z', 'a']
    const original = [...groups]
    const first = client({identity: 'alice', groups, enableTelemetry: false})
    const reversed = client({identity: 'alice', groups: [...groups].reverse(), enableTelemetry: false})
    const expected = `v2:${encodeURIComponent(JSON.stringify(['alice', ['10', '2', 'A', 'Z', 'a', 'a', 'ä', '😀'], []]))}`
    expect((first as any)._contextCacheKey()).toBe(expected)
    expect((reversed as any)._contextCacheKey()).toBe(expected)
    expect(groups).toEqual(original)
  })
  it('records effective leaves before negation and retains short circuiting with optional identity', async () => {
    const service = client({identity: 'private-user', groups: ['private-group'], claims: {role: 'private-role'}})
    expect(await service.isFeatureOff('Off')).toBe(true)
    expect(await service.evaluateFeatureGate(['Off', 'On'], 'all', true)).toBe(true)
    expect(await service.evaluateFeatureGate(['On', 'Off'], 'any', false)).toBe(true)
    expect(service.getEffectiveFlagValue('On')).toBe(true)
    await service.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'test', e: 'Test', u: 'private-user', f: {Off: {disabled: [2]}, On: {enabled: [2]}}})
    expect(sent[0].url).toBe('https://metrics.toggly.io/api/frontend/telemetry')
    expect(sent[0].init.credentials).toBe('omit')
    expect(JSON.stringify(sent)).not.toContain('private-group')
    expect(JSON.stringify(sent)).not.toContain('private-role')
  })
  it('counts local and entity gates at the effective outcome', async () => {
    definitions = {On: true, Entity: {requirement: 'all', rules: [{property: 'role', op: 'eq', value: 'admin', type: 'string'}]}}
    const gate = vi.fn(() => false)
    const service = client({localGates: [{id: 'device', flagKeys: ['On'], isEnabled: gate}]})
    expect(await service.isFeatureOn('On')).toBe(false)
    expect(await service.isFeatureOn('Entity', {kind: 'User', key: 'secret', attributes: {role: 'admin'}})).toBe(true)
    expect(await service.isFeatureOn('Entity')).toBe(false)
    await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {disabled: [1]}, Entity: {enabled: [1], disabled: [1]}})
    expect(gate).toHaveBeenCalledTimes(1)
  })
  it('keeps hydration/refresh silent and counts variant and delegated value once', async () => {
    definitions = {On: {enabled: true, variant: 'control', configurationValue: 7}, Off: {enabled: false, variant: 'experiment'}, Plain: {enabled: true}}
    const service = client({enableVariants: true})
    await service._loadFeatures(); await service.flushTelemetry(); expect(sent).toEqual([])
    expect(await service.isFeatureOn('On')).toBe(true)
    expect(service.getVariant('On')?.name).toBe('control')
    expect(service.getVariantValue('On')).toBe(7)
    expect(service.getVariant('Off')).toBeNull()
    expect(service.getVariant('Plain')).toBeNull()
    await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {control: [3]}, Off: {disabled: [1]}, Plain: {enabled: [1]}})
    sent.length = 0; await service.setContext({identity: 'next'}); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('explicit events use enabled by default and gauges retain the latest value', async () => {
    const service = client({metricsBaseUrl: 'https://collector.test/base/'})
    service.recordUsage('On'); service.recordView('On', 'control'); service.incrementCounter('orders'); service.incrementCounter('orders', 2); service.setGauge('cart', 9); service.setGauge('cart', 3)
    await service.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'test', e: 'Test', f: {On: {enabled: [0, 1], control: [0, 0, 1]}}, m: {orders: 3, cart: 3}})
    expect(sent[0].url).toBe('https://collector.test/base/api/frontend/telemetry')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it.each([{enableTelemetry: false}, {appKey: undefined, featureDefaults: {On: true}}])('stays silent with %j', async options => {
    const listeners = vi.spyOn(window, 'addEventListener')
    const service = client(options)
    await service.isFeatureOn('On'); service.recordUsage('On'); service.recordView('On'); service.incrementCounter('orders'); service.setGauge('cart', 1); await service.flushTelemetry()
    expect(sent).toEqual([])
    expect(listeners.mock.calls.filter(([event]) => event === 'pagehide')).toEqual([])
  })
  it('cancels old transport and isolates reinitialization from previous app data', async () => {
    const service = client({appKey: 'old', environment: 'Old'})
    expect(await service.isFeatureOn('On')).toBe(true)
    definitions = {On: false}
    service.init({appKey: 'new', environment: 'New', persistCache: false, enableLiveUpdates: false})
    expect(await service.isFeatureOn('On')).toBe(false)
    await service.flushTelemetry(); await flushPromises()
    expect(sent.map(x => x.body)).toEqual([{k: 'new', e: 'New', f: {On: {disabled: [1]}}}])
  })
  it('drops late old initialization without restarting sockets or counting under a new app', async () => {
    let complete!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const websocket = vi.spyOn(globalThis, 'WebSocket')
    const service = client({appKey: 'old', enableLiveUpdates: true})
    const pending = service.isFeatureOn('On'); await flushPromises()
    service.dispose()
    service.init({appKey: 'new', environment: 'New', persistCache: false, enableLiveUpdates: false})
    definitions = {On: false}; expect(await service.isFeatureOn('On')).toBe(false)
    complete(response({On: true})); await pending; await service.flushTelemetry()
    expect(sent.map(x => x.body)).toEqual([{k: 'new', e: 'New', f: {On: {disabled: [1]}}}])
    expect(service.getEffectiveFlagValue('On')).toBe(false)
    expect(websocket).not.toHaveBeenCalled()
  })
  it('flushes on pagehide and detaches on idempotent disposal', async () => {
    const service = client(); service.recordUsage('On')
    window.dispatchEvent(new Event('pagehide')); await flushPromises(); expect(sent).toHaveLength(1)
    service.recordUsage('On'); service.dispose(); service.dispose(); await flushPromises(); expect(sent).toHaveLength(2)
    service.recordUsage('On'); window.dispatchEvent(new Event('pagehide')); await service.flushTelemetry(); expect(sent).toHaveLength(2)
  })
  it('uses one app owner across components/composables and only counts actual recomputation', async () => {
    definitions = {On: {enabled: true, variant: 'control', configurationValue: 7}}
    const service = client({enableVariants: true}); await service._loadFeatures()
    const Probe = defineComponent({setup() {return {...useVariant('On', service), ...useFeatureFlag('On', {toggly: service})}}, template: '<span>{{variantValue}}/{{isEnabled}}</span>'})
    const wrapper = mount(defineComponent({render: () => h('div', [h(Probe), h(Feature, {featureKey: 'On'}), h(FeatureGateBuilder, {featureKey: 'On'})])}), {global: {provide: {$toggly: service}}})
    cleanups.push(() => wrapper.unmount()); await flushPromises(); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {control: [4]}})
    expect(wrapper.text()).toContain('7/true'); sent.length = 0
    service.notifyLocalGatesChanged(); await flushPromises(); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {control: [4]}})
    wrapper.unmount(); cleanups.pop(); sent.length = 0
    service.notifyLocalGatesChanged(); await flushPromises(); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('rebinds reactive service overrides without reporting an old value under the new owner', async () => {
    const first = client({appKey: 'first', environment: 'Old'}); await first._loadFeatures()
    definitions = {On: false}; const second = client({appKey: 'second', environment: 'New'}); await second._loadFeatures()
    const options = shallowRef({featureKey: 'On', toggly: first})
    const wrapper = mount(defineComponent({setup: () => useFeatureGate(options), template: '<span>{{isEnabled}}</span>'}))
    cleanups.push(() => wrapper.unmount()); await flushPromises(); await first.flushTelemetry(); sent.length = 0
    options.value = {featureKey: 'On', toggly: second}; await nextTick(); await flushPromises(); await second.flushTelemetry()
    expect(wrapper.text()).toBe('false')
    expect(sent[0].body).toEqual({k: 'second', e: 'New', f: {On: {disabled: [1]}}}); sent.length = 0
    first.notifyLocalGatesChanged(); await flushPromises(); await first.flushTelemetry(); await second.flushTelemetry(); expect(sent).toEqual([])
    second.notifyLocalGatesChanged(); await flushPromises(); await second.flushTelemetry(); expect(sent[0].body.f).toEqual({On: {disabled: [1]}})
  })
  it('plugin apps own independent services and unmount disposes only that app', async () => {
    const services: Toggly[] = []
    const Probe = defineComponent({setup() {services.push(inject<Toggly>('$toggly')!); return () => h('span')}})
    const first = createApp(Probe).use(plugin, {appKey: 'first', environment: 'Old', enableLiveUpdates: false})
    const second = createApp(Probe).use(plugin, {appKey: 'second', environment: 'New', enableLiveUpdates: false})
    first.mount(document.createElement('div')); second.mount(document.createElement('div'))
    expect(services[0]).not.toBe(services[1]); services[0].recordUsage('On'); first.unmount(); await flushPromises()
    services[1].recordUsage('On'); await services[1].flushTelemetry()
    expect(sent.map(x => x.body.k)).toEqual(['first', 'second'])
    services[0].recordUsage('On'); second.unmount(); await flushPromises(); expect(sent).toHaveLength(2)
  })
  it('counts each cold mounted consumer once when the initial load notifies subscribers', async () => {
    definitions = {On: {enabled: true, variant: 'control'}}
    const service = client({enableVariants: true})
    const Probe = defineComponent({setup() {useVariant('On'); return useFeatureFlag('On')}, template: '<span>{{isEnabled}}</span>'})
    const wrapper = mount(defineComponent({render: () => h('div', [h(Probe), h(Feature, {featureKey: 'On'}), h(FeatureGateBuilder, {featureKey: 'On'})])}), {global: {provide: {$toggly: service}}})
    cleanups.push(() => wrapper.unmount()); await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 120)); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {control: [4]}})
  })
  it('does not evaluate an unmounted variant consumer after a delayed load', async () => {
    let complete!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const service = client({enableVariants: true})
    let refresh!: () => Promise<void>
    const wrapper = mount(defineComponent({setup() {const state = useVariant('On', service); refresh = state.refresh; return state}, template: '<span>{{variantValue}}</span>'}))
    await flushPromises(); wrapper.unmount()
    complete(response({On: {enabled: true, variant: 'control', configurationValue: 7}}))
    await flushPromises(); await refresh(); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('mounted consumers follow reinitialization while an old variants load is still pending', async () => {
    let complete!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const service = client({appKey: 'old', environment: 'Old', enableVariants: true})
    const Probe = defineComponent({setup() {return {...useVariant('On', service), ...useFeatureFlag('On', {toggly: service})}}, template: '<span>{{variantValue}}/{{isEnabled}}</span>'})
    const wrapper = mount(defineComponent({render: () => h('div', [h(Probe), h(Feature, {featureKey: 'On'}, () => 'feature'), h(FeatureGateBuilder, {featureKey: 'On'}, {default: ({enabled}: {enabled: boolean}) => String(enabled)})])}), {global: {provide: {$toggly: service}}})
    cleanups.push(() => wrapper.unmount()); await flushPromises()
    definitions = {On: {enabled: true, variant: 'new', configurationValue: 'new-value'}}
    service.init({appKey: 'new', environment: 'New', enableVariants: true, persistCache: false, enableLiveUpdates: false})
    await flushPromises(); await new Promise(resolve => setTimeout(resolve, 120))
    complete(response({On: {enabled: false, variant: 'old', configurationValue: 'old-value'}}))
    await flushPromises(); await service.flushTelemetry()
    expect(wrapper.text()).toBe('new-value/truefeaturetrue')
    expect(sent.map(x => x.body)).toEqual([{k: 'new', e: 'New', f: {On: {new: [4]}}}])
  })
  it('stays silent for cache hydration and disabled variant API, and counts local variant denial', async () => {
    localStorage.setItem('toggly:variants:test:Test', JSON.stringify({On: {enabled: true, variant: 'control'}}))
    const service = client({persistCache: true, enableVariants: true, localGates: [{id: 'deny', flagKeys: ['On'], isEnabled: () => false}]})
    await service._featuresLoaded(); await service.flushTelemetry(); expect(sent).toEqual([])
    expect(service.getVariantValue('On')).toBeNull(); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {disabled: [1]}})
    sent.length = 0; const other = client(); expect(other.getVariant('On')).toBeNull(); await other.flushTelemetry(); expect(sent).toEqual([])
  })
  it('disposal blocks delayed failed definitions and all later telemetry work', async () => {
    let reject!: (error: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((_, fail) => {reject = fail}))
    const service = client({enableLiveUpdates: true}); const pending = service.isFeatureOn('On'); await flushPromises()
    service.dispose(); reject(Error('late failure')); expect(await pending).toBe(false)
    await service._loadFeatures(); expect(await service.isFeatureOn('On')).toBe(false)
    await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('invalid telemetry configuration cannot break evaluation through a throwing diagnostic', async () => {
    const service = client({metricsBaseUrl: 'https://collector.test?', telemetryFlushIntervalMs: 0, onError: () => {throw Error('host')}})
    expect(await service.isFeatureOn('On')).toBe(true); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('seals attribution and gauges across token rotation, identity changes and logout', async () => {
    const service=client({identity:'alice',instanceId:'mint-a'} as TogglyOptions); service.setGauge('cart',1);
    await service.setContext({instanceId:'mint-b'} as any); service.setGauge('cart',2);
    await service.setContext({identity:'bob'}); service.setGauge('cart',3);
    await service.setContext({identity:''}); service.setGauge('cart',4); await service.flushTelemetry();
    expect(sent.map(x=>[x.body.i,x.body.u,x.body.m.cart])).toEqual([
      ['mint-a',undefined,1],['mint-b',undefined,2],[undefined,'bob',3],[undefined,undefined,4],
    ]);
  });
  it('uses only minted targeting and isolates token caches, response-mode revisions and 304 hydration', async () => {
    const service=client({identity:'alice',instanceId:'mint-a',persistCache:true,groups:['staff'],claims:{role:'admin'}} as TogglyOptions);
    await service._loadFeatures();
    const first=new URL(fetchMock.mock.calls[0][0]); expect(first.searchParams.get('i')).toBe('mint-a');
    for(const key of ['u','userId','g','claim.role']) expect(first.searchParams.has(key)).toBe(false);
    (service as any)._cacheDefinitionsRevision('revision-a');
    const aKey=(service as any)._contextCacheKey();
    definitions={On:false}; await service.setContext({instanceId:'mint-b'} as any);
    expect((service as any)._contextCacheKey()).not.toBe(aKey); expect((service as any)._definitionsRevision).toBeNull();
    fetchMock.mockResolvedValueOnce({ok:false,status:304}); await service.setContext({instanceId:'mint-a'} as any);
    expect((service as any)._features.On).toBe(true);
    const variant=client({instanceId:'mint-a',persistCache:true,enableVariants:true} as TogglyOptions);
    expect((variant as any)._definitionsRevision).toBeNull();
    await service.setContext({identity:'bob'}); const last=new URL(fetchMock.mock.calls[fetchMock.mock.calls.length-1][0]);
    expect(last.searchParams.has('i')).toBe(false); expect(last.searchParams.get('u')).toBe('bob');
  });
  it('captures the synchronous assigned variant and attribution before reentrant local gates', async () => {
    definitions={On:{enabled:true,variant:'old',configurationValue:7}};
    const service=client({identity:'alice',enableVariants:true}); await service._loadFeatures();
    let transition:Promise<void>|undefined;
    service.setLocalGates([{id:'reenter',flagKeys:['On'],isEnabled:()=>{
      definitions={On:{enabled:true,variant:'new'}}; transition=service.setContext({identity:'bob'}); service.recordUsage('New'); return true;
    }}]);
    expect(service.getVariant('On')).toEqual({name:'old',configurationValue:7}); await transition; await service.flushTelemetry();
    expect(sent.find(x=>x.body.u==='alice')?.body.f.On).toEqual({old:[1]});
    expect(sent.find(x=>x.body.u==='bob')?.body.f.New).toEqual({enabled:[0,1]});
  });
  it('captures before reentrant hook and entity mapping callbacks', async () => {
    const service=client({identity:'alice'}); await service._loadFeatures();
    service.addHook({getMetadata:()=>({name:'reenter'}),beforeEvaluation:async()=>{
      await service.setContext({identity:'bob'}); return undefined;
    }} as any);
    expect(await service.isFeatureOn('On')).toBe(true); await service.flushTelemetry();
    expect(sent[0].body.u).toBe('alice'); service.removeHook('reenter'); sent.length=0;
    let transition:Promise<void>|undefined;
    service.registerContext('VueTelemetryMapper',()=>{
      definitions={On:false}; transition=service.setContext({identity:'carol'}); return {kind:'User',key:'test',attributes:{}};
    });
    expect(await service.isFeatureOn('On',{},'VueTelemetryMapper')).toBe(true); await transition; await service.flushTelemetry();
    expect(sent[0].body.u).toBe('bob');
  });
  it('rejects stale ABA responses and never restores a disposed context', async () => {
    const pending:Array<(value:any)=>void>=[];
    fetchMock.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    const service=client({identity:'alice'});
    const a=service.setContext({identity:'alice'}); await flushPromises();
    const b=service.setContext({identity:'bob'}); await flushPromises();
    const c=service.setContext({identity:'alice'}); await flushPromises();
    expect(pending.length).toBe(3);
    const response=(defs:any)=>({ok:true,status:200,text:async()=>JSON.stringify(defs)});
    pending[2]?.(response({Current:true})); await c;
    pending[0]?.(response({Stale:true})); pending[1]?.(response({Stale:true})); await Promise.all([a,b]);
    expect((service as any)._features).toEqual({Current:true});
    const d=service.setContext({identity:'after'}); await flushPromises(); service.dispose(); pending[3]?.(response({Resurrected:true})); await d;
    expect((service as any)._features).not.toEqual({Resurrected:true});
  });

  it('retains retry bytes and immediate post-transition events in one owner', async () => {
    vi.useFakeTimers();
    try {
      let complete:(value:any)=>void=()=>{};
      const original=fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((input:string,init?:RequestInit)=>{
        if(input.includes('/api/frontend/telemetry') && sent.length===0) {
          sent.push({url:input,init:init!,body:JSON.parse(init!.body as string)});
          return new Promise(resolve=>complete=resolve);
        }
        return original(input,init);
      });
      const service=client({identity:'alice'}); service.setGauge('cart',1); const flushing=service.flushTelemetry(); await flushPromises();
      const reporter=(service as any)._telemetry;
      await service.setContext({identity:'bob'}); service.setGauge('cart',2); complete({status:429}); await flushPromises();
      await vi.advanceTimersByTimeAsync(30000); await flushing; await service.flushTelemetry();
      expect((service as any)._telemetry).toBe(reporter);
      expect(sent.map(x=>[x.body.u,x.body.m.cart])).toEqual([['alice',1],['alice',1],['bob',2]]);
      expect(sent[0].init.body).toBe(sent[1].init.body);
    } finally { vi.useRealTimers(); }
  });
  it('keeps a single globally bounded reporter through 2200 context changes', async () => {
    const onError=vi.fn(); const service=client({onError}); service.recordUsage('Initial');
    const reporter=(service as any)._telemetry;
    for(let index=0;index<2200;index++) { await service.setContext({identity:`fixture-${index}`}); service.incrementCounter('orders'); }
    expect((service as any)._telemetry).toBe(reporter);
    expect(onError.mock.calls.some(args=>String(args[0]).includes('buffer-full'))).toBe(true);
    await service.flushTelemetry(); expect(sent.length).toBeGreaterThan(0); expect(sent.length).toBeLessThanOrEqual(2000);
    expect(sent.reduce((size,x)=>size+Buffer.byteLength(JSON.stringify(x.body)),0)).toBeLessThanOrEqual(262144);
  }, 15_000); // Full 2200-context admission workload; coverage on hosted runners exceeds the default 5s.
  it('rejects foreign owner captures, orphan revisions and delimiter collisions', async () => {
    const first=client({identity:'alice|g:staff',persistCache:true}); const second=client({identity:'alice',groups:['staff'],persistCache:true});
    expect((first as any)._contextCacheKey()).not.toBe((second as any)._contextCacheKey());
    await first._loadFeatures();
    expect((second as any)._getEffectiveFlagValue('On',undefined,(first as any)._captureEvaluation())).toBe(false);
    localStorage.clear(); localStorage.setItem('toggly:revision:test:Test:'+(first as any)._revisionScope(),'orphan');
    expect((first as any)._definitionsRevision).toBeNull();
    first.dispose(); await first.setContext({identity:'after'}); expect((first as any)._config.identity).toBe('alice|g:staff');
  });

  it('restarts live updates after returning to a token with a cached 304 snapshot', async () => {
    const sockets:any[]=[];
    vi.spyOn(globalThis,'WebSocket').mockImplementation((()=>{
      const socket={close:vi.fn()}; sockets.push(socket); return socket;
    }) as any);
    const service=client({instanceId:'mint-a',persistCache:true,enableLiveUpdates:true}); await service._loadFeatures();
    (service as any)._cacheDefinitionsRevision('revision-a');
    const oldMessage = sockets[0].onmessage; const oldClose = sockets[0].onclose;
    await service.setContext({instanceId:'mint-b'});
    fetchMock.mockResolvedValueOnce({ok:false,status:304}); await service.setContext({instanceId:'mint-a'});
    expect(sockets).toHaveLength(3); expect((service as any)._ws).toBe(sockets[2]);
    oldMessage({data: JSON.stringify({type: 'flags-updated', etag: 'retired'})}); oldClose();
    expect((service as any)._pendingDefinitionsPin).toBeNull(); expect((service as any)._ws).toBe(sockets[2]);
    expect(sockets[0].onmessage).toBeNull(); expect(sockets[1].onmessage).toBeNull();
  });

  it('withholds a variant superseded by a reentrant context transition', async () => {
    definitions = {On: {enabled: true, variant: 'old', configurationValue: 7}}
    const service = client({identity: 'alice', enableVariants: true}); await service._loadFeatures()
    const observed: (string | undefined)[] = []
    const wrapper = mount(defineComponent({setup() {
      const state = useVariant('On', service)
      watch(state.variant, value => {if ((service as any)._config.identity === 'bob') observed.push(value?.name)}, {flush: 'sync'})
      return state
    }, template: '<span>{{variant?.name}}/{{isLoading}}</span>'}))
    cleanups.push(() => wrapper.unmount()); await flushPromises()
    let complete!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    let first = true
    let transition!: Promise<void>
    service.setLocalGates([{id: 'reenter', flagKeys: ['On'], isEnabled: () => {
      if (first) {first = false; transition = service.setContext({identity: 'bob'})}
      return true
    }}])
    service.notifyLocalGatesChanged(); await flushPromises()
    expect(wrapper.text()).toBe('/false')
    expect(observed).not.toContain('old')
    complete(response({On: {enabled: true, variant: 'new'}})); await transition; await flushPromises()
    expect(wrapper.text()).toBe('new/false')
  })
  it('does not let an older boolean hook result replace newer context state', async () => {
    const service = client({identity: 'alice'}); await service._loadFeatures()
    let finish!: () => void
    let first = true
    service.addHook({getMetadata: () => ({name: 'delay'}), beforeEvaluation: () => {
      if (first) {first = false; return new Promise<void>(resolve => {finish = resolve})}
    }} as any)
    const wrapper = mount(defineComponent({setup: () => useFeatureFlag('On', {toggly: service}), template: '<span>{{isEnabled}}</span>'}))
    cleanups.push(() => wrapper.unmount()); await flushPromises()
    definitions = {On: false}; await service.setContext({identity: 'bob'}); await flushPromises()
    expect(wrapper.text()).toBe('false'); finish(); await flushPromises(); expect(wrapper.text()).toBe('false')
  })

  it('hydrates matching token variants on A-B-A 304 and clears only that revision scope', async () => {
    definitions = {On: {enabled: true, variant: 'assigned-a', configurationValue: 7}}
    const service = client({instanceId: 'mint-a', enableVariants: true, persistCache: true})
    await service._loadFeatures(); (service as any)._cacheDefinitionsRevision('revision-a')
    const aScope = (service as any)._revisionScope()
    definitions = {On: {enabled: false, variant: 'assigned-b'}}
    await service.setContext({instanceId: 'mint-b'}); (service as any)._cacheDefinitionsRevision('revision-b')
    const bScope = (service as any)._revisionScope()
    fetchMock.mockResolvedValueOnce({ok: false, status: 304})
    await service.setContext({instanceId: 'mint-a'})
    expect(service.getVariant('On')).toEqual({name: 'assigned-a', configurationValue: 7})
    const call = fetchMock.mock.calls.filter(([url]) => !url.includes('/api/frontend/telemetry')).at(-1)!
    expect((call[1]?.headers as Record<string, string>)['If-None-Match']).toBe('revision-a')
    service.clearFeatureFlagsCache()
    expect((service as any)._definitionsRevision).toBeNull()
    expect(localStorage.getItem('toggly:revision:test:Test:' + aScope)).toBeNull()
    expect(localStorage.getItem('toggly:revision:test:Test:' + bScope)).toBe('revision-b')
  })
  it('explicitly clears a token back to current identity and preserves it for partial targeting updates', async () => {
    const service = client({identity: 'alice', instanceId: 'mint-a'})
    await service.setContext({groups: ['staff']}); service.recordUsage('Minted')
    await service.setContext({instanceId: ''}); service.recordUsage('Client')
    await service.flushTelemetry()
    expect(sent.map(x => [x.body.i, x.body.u])).toEqual([['mint-a', undefined], [undefined, 'alice']])
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('g')).toBe('staff')
  })
  it('keeps a reentrant error handler transition instead of recovering the retired failure', async () => {
    let transition!: Promise<void>
    const service = client({identity: 'alice', onError: () => {
      definitions = {Current: true}; transition = service.setContext({identity: 'carol'})
    }})
    await service._loadFeatures()
    fetchMock.mockRejectedValueOnce(Error('retired'))
    await service.setContext({identity: 'bob'}); await transition
    expect((service as any)._config.identity).toBe('carol')
    expect((service as any)._features).toEqual({Current: true})
  })

  it('keeps missing variant entries disabled even when boolean defaults are enabled', async () => {
    const service = client({enableVariants: true, featureDefaults: {On: true}})
    fetchMock.mockRejectedValueOnce(Error('offline'))
    await service._loadFeatures()
    expect(service.getVariant('On')).toBeNull(); await service.flushTelemetry()
    expect(sent[0].body.f.On).toEqual({disabled: [1]})
  })

  it('cancels an earlier disposal send before reinitializing the same service', async () => {
    let retiredSignal: AbortSignal | null | undefined
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/frontend/telemetry') && JSON.parse(init!.body as string).k === 'old') {
        retiredSignal = init?.signal
        return new Promise(() => {})
      }
      return original(url, init)
    })
    const service = client({appKey: 'old'}); service.recordUsage('On'); service.dispose(); await flushPromises()
    expect(retiredSignal?.aborted).toBe(false)
    service.init({appKey: 'new', environment: 'Test', enableLiveUpdates: false, persistCache: false})
    expect(retiredSignal?.aborted).toBe(true)
    service.recordUsage('New'); await service.flushTelemetry()
    expect(sent.map(x => x.body.k)).toEqual(['new'])
  })

})
