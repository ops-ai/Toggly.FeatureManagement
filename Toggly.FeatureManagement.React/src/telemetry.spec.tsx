import React, { StrictMode, useContext } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Toggly, TogglyOptions } from './services'
import { Provider, context } from './contexts/toggly.context'
import { createTogglyProvider, Feature } from './components'
import { useFeatureFlag } from './hooks/useFeatureFlag'
import { useVariant } from './hooks/useVariant'

type Client = Toggly
type Options = TogglyOptions
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('React frontend telemetry', () => {
  let clients: Client[]
  let sent: {url: string; body: any; init: RequestInit}[]
  let definitions: Record<string, unknown>
  let fetchMock: jest.Mock
  function client(options: Options = {}): Client {
    const service = new Toggly({appKey: 'telemetry-test', environment: 'Production', persistCache: false, enableLiveUpdates: false, ...options}) as Client
    clients.push(service)
    return service
  }
  beforeEach(() => {
    clients = []; sent = []; definitions = {On: true, Off: false}
    localStorage.clear()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/api/frontend/telemetry')) {
        sent.push({url: input, init: init!, body: JSON.parse(init!.body as string)})
        return {status: 202}
      }
      return {ok: true, status: 200, json: async () => definitions, text: async () => JSON.stringify(definitions)}
    })
    globalThis.fetch = fetchMock
  })
  afterEach(async () => {
    cleanup()
    clients.forEach(service => service.dispose?.())
    await settle()
    jest.restoreAllMocks()
  })
  it('records effective leaves before negation and preserves all/any short circuiting', async () => {
    const service = client({identity: 'private-user', groups: ['private-group'], claims: {role: 'private-role'}})
    expect(await service.isFeatureOff('Off')).toBe(true)
    expect(await service.evaluateFeatureGate(['Off', 'On'], 'all', true)).toBe(true)
    expect(await service.evaluateFeatureGate(['On', 'Off'], 'any')).toBe(true)
    await service.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'telemetry-test', e: 'Production', u:'private-user', f: {Off: {disabled: [2]}, On: {enabled: [1]}}})
    expect(sent[0].url).toBe('https://metrics.toggly.io/api/frontend/telemetry')
    expect(sent[0].init.credentials).toBe('omit')
    expect(sent[0].init.headers).toEqual({'Content-Type': 'application/json'})
    expect(JSON.stringify(sent)).not.toContain('private-group'); expect(JSON.stringify(sent)).not.toContain('private-role')
  })
  it('counts local and entity outcomes after their gates', async () => {
    definitions = {On: true, Entity: {requirement: 'all', rules: [{property: 'role', op: 'eq', value: 'admin', type: 'string'}]}}
    const localGate = jest.fn(() => false)
    const service = client({localGates: [{id: 'device', flagKeys: ['On'], isEnabled: localGate}]})
    expect(await service.isFeatureOn('On')).toBe(false)
    expect(await service.isFeatureOn('Entity', {kind: 'User', key: 'secret', attributes: {role: 'admin'}})).toBe(true)
    expect(await service.isFeatureOn('Entity')).toBe(false)
    await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {disabled: [1]}, Entity: {enabled: [1], disabled: [1]}})
    expect(localGate).toHaveBeenCalledTimes(1)
  })
  it('counts synchronous variant and delegated value requests once', async () => {
    definitions = {On: {enabled: true, variant: 'control', configurationValue: 7}, Off: {enabled: false, variant: 'experiment'}, Plain: {enabled: true}}
    const service = client({enableVariants: true})
    await service._loadFeatures()
    await service.flushTelemetry(); expect(sent).toEqual([])
    expect(await service.isFeatureOn('On')).toBe(true)
    expect(service.getVariant('On')).toEqual({name: 'control', configurationValue: 7})
    expect(service.getVariantValue('On')).toBe(7)
    expect(service.getVariant('Off')).toBeNull()
    expect(service.getVariant('Plain')).toBeNull()
    await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {control: [3]}, Off: {disabled: [1]}, Plain: {enabled: [1]}})
  })
  it('keeps explicit events independent of feature evaluation and app context immutable', async () => {
    const first = client({appKey: 'old', environment: 'Staging'})
    const second = client({appKey: 'new', metricsBaseUrl: 'https://collector.test/base/'})
    first.recordUsage('On'); first.recordView('On', 'control'); first.incrementCounter('orders'); first.incrementCounter('orders', 2); first.setGauge('cart', 9); first.setGauge('cart', 3)
    second.recordUsage('On'); first.dispose(); await settle(); await second.flushTelemetry()
    expect(sent.map(x => x.body)).toEqual([
      {k: 'old', e: 'Staging', f: {On: {enabled: [0, 1], control: [0, 0, 1]}}, m: {orders: 3, cart: 3}},
      {k: 'new', e: 'Production', f: {On: {enabled: [0, 1]}}},
    ])
    expect(sent[1].url).toBe('https://collector.test/base/api/frontend/telemetry')
    expect(fetchMock.mock.calls.every(([url]) => url.includes('/api/frontend/telemetry'))).toBe(true)
  })
  it('does not count cache hydration, internal loads or context refresh', async () => {
    localStorage.setItem('toggly:flags:telemetry-test:Production', JSON.stringify({Cached: true}))
    const service = client({persistCache: true})
    await service._featuresLoaded(); await service.flushTelemetry(); expect(sent).toEqual([])
    expect(await service.isFeatureOn('Cached')).toBe(true)
    await service.flushTelemetry(); expect(sent[0].body.f).toEqual({Cached: {enabled: [1]}})
    sent.length = 0
    await service.setContext({identity: 'new-user'}); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  for (const [name, options] of [['opt-out', {enableTelemetry: false}], ['no-key', {appKey: undefined, featureDefaults: {On: true}}]] as const) {
    it(`${name} starts no telemetry timers or lifecycle listeners`, async () => {
      const timeout = jest.spyOn(globalThis, 'setTimeout')
      const listeners = jest.spyOn(window, 'addEventListener')
      const service = client(options)
      await service.isFeatureOn('On'); service.recordUsage('On'); await service.flushTelemetry(); service.dispose()
      expect(sent).toEqual([])
      expect(timeout.mock.calls.filter(([, delay]) => Number(delay) >= 30000)).toEqual([])
      expect(listeners.mock.calls.filter(([event]) => event === 'pagehide')).toEqual([])
    })
  }
  it('pagehide flushes and disposal detaches listeners and rejects later events', async () => {
    const service = client()
    service.recordUsage('On'); window.dispatchEvent(new Event('pagehide')); await settle()
    expect(sent).toHaveLength(1)
    service.recordUsage('On'); service.dispose(); await settle(); expect(sent).toHaveLength(2)
    service.recordUsage('On'); window.dispatchEvent(new Event('pagehide')); await service.flushTelemetry()
    expect(sent).toHaveLength(2)
  })
  it('cached useVariant and Feature variant filtering each count once per recomputation', async () => {
    definitions = {On: {enabled: true, variant: 'control'}}
    const service = client({enableVariants: true}); await service._loadFeatures()
    const snapshots: (string | undefined)[] = []
    function VariantProbe() { const variant = useVariant('On'); snapshots.push(variant?.name); return <span data-testid="variant">{variant?.name}</span> }
    const tree = render(<Provider value={{toggly: service}}><VariantProbe/><Feature featureKey="On" variant="control"><span>visible</span></Feature></Provider>)
    await act(settle); await service.flushTelemetry()
    expect(snapshots[0]).toBe('control')
    expect(screen.getByTestId('variant')).toHaveTextContent('control'); expect(screen.getByText('visible')).toBeInTheDocument()
    expect(sent[0].body.f).toEqual({On: {control: [2]}})
    sent.length = 0
    await act(async () => { service.notifyLocalGatesChanged(); await settle() }); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {control: [2]}})
    tree.unmount(); sent.length = 0
    service.notifyLocalGatesChanged(); await settle(); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('single-flag hooks forward entity context to the counted effective evaluation', async () => {
    definitions = {Entity: {requirement: 'all', rules: [{property: 'role', op: 'eq', value: 'admin', type: 'string'}]}}
    const service = client(); await service._loadFeatures()
    const entity = {kind: 'User', key: 'secret', attributes: {role: 'admin'}}
    function Probe() { return <span>{useFeatureFlag('Entity', {context: entity}).isEnabled ? 'allowed' : 'denied'}</span> }
    render(<Provider value={{toggly: service}}><Probe/></Provider>)
    await act(settle); expect(screen.getByText('allowed')).toBeInTheDocument(); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({Entity: {enabled: [1]}})
  })
  it('an unused provider factory does not start background telemetry resources', async () => {
    const timeout = jest.spyOn(globalThis, 'setTimeout')
    const listeners = jest.spyOn(window, 'addEventListener')
    await createTogglyProvider({appKey: 'unused', environment: 'Test'})
    expect(timeout.mock.calls).toEqual([])
    expect(listeners.mock.calls.filter(([event]) => event === 'pagehide')).toEqual([])
  })
  it('Feature follows replacement service ownership and drops old subscriptions', async () => {
    const first = client({appKey: 'first'}); const second = client({appKey: 'second'})
    await first._loadFeatures(); definitions = {On: false}; await second._loadFeatures()
    const child = <Feature featureKey="On" render={enabled => <span>{enabled ? 'allowed' : 'denied'}</span>} />
    const tree = render(<Provider value={{toggly: first}}>{child}</Provider>)
    await act(settle); await first.flushTelemetry(); sent.length = 0
    tree.rerender(<Provider value={{toggly: second}}>{child}</Provider>)
    await act(settle); expect(screen.getByText('denied')).toBeInTheDocument()
    await second.flushTelemetry(); expect(sent[0].body).toEqual({k: 'second', e: 'Production', f: {On: {disabled: [1]}}})
    sent.length = 0
    await act(async () => {first.notifyLocalGatesChanged(); await settle()}); await first.flushTelemetry(); await second.flushTelemetry()
    expect(sent).toEqual([])
  })
  it('concurrent mounts from the same factory retain their shared service until the last unmount', async () => {
    let first: Client | undefined; let second: Client | undefined
    function Probe({name}: {name: string}) {
      const service = useContext(context).toggly as Client
      if (name === 'first') first = service; else second = service
      return null
    }
    const ManagedProvider = await createTogglyProvider({appKey: 'shared', environment: 'Test'})
    const firstTree = render(<ManagedProvider><Probe name="first"/></ManagedProvider>)
    const secondTree = render(<ManagedProvider><Probe name="second"/></ManagedProvider>)
    await act(settle); expect(first).toBe(second)
    firstTree.unmount(); await settle()
    second!.recordUsage('On'); await second!.flushTelemetry(); expect(sent).toHaveLength(1)
    second!.recordUsage('On'); secondTree.unmount(); await settle(); expect(sent).toHaveLength(2)
  })
  it('late definitions completion cannot reopen resources after disposal', async () => {
    let complete!: (value: any) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const websocket = jest.spyOn(globalThis, 'WebSocket')
    const service = client({enableLiveUpdates: true})
    const loading = service.isFeatureOn('On'); await settle()
    service.dispose()
    complete({ok: true, status: 200, text: async () => JSON.stringify({On: true})})
    expect(await loading).toBe(false)
    expect((service as any)._features).toBeNull()
    await service.flushTelemetry(); expect(sent).toEqual([]); expect(websocket).not.toHaveBeenCalled()
  })
  it('invalid telemetry configuration and throwing diagnostic callbacks do not affect flags', async () => {
    const service = client({metricsBaseUrl: 'https://collector.test?', telemetryFlushIntervalMs: 0, onError: () => {throw new Error('host callback')}})
    expect(await service.isFeatureOn('On')).toBe(true)
    service.recordUsage('On'); await service.flushTelemetry(); expect(sent).toEqual([])
  })
  it('a local variant denial records disabled while variant-disabled lookups stay silent', async () => {
    definitions = {On: {enabled: true, variant: 'control'}}
    const service = client({enableVariants: true, localGates: [{id: 'deny', flagKeys: ['On'], isEnabled: () => false}]})
    await service._loadFeatures(); expect(service.getVariantValue('On')).toBeNull(); await service.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {disabled: [1]}})
    sent.length = 0
    const disabled = client(); expect(disabled.getVariant('On')).toBeNull(); await disabled.flushTelemetry(); expect(sent).toEqual([])
  })
  it('provider effect replay keeps one owner and final unmount disposes it', async () => {
    let service: Client | undefined
    function Probe() { service = useContext(context).toggly as Client; return <span>mounted</span> }
    const listeners = jest.spyOn(window, 'addEventListener')
    const ManagedProvider = await createTogglyProvider({appKey: 'provider', environment: 'Test', enableLiveUpdates: false})
    const tree = render(<StrictMode><ManagedProvider><Probe/></ManagedProvider></StrictMode>)
    await act(settle)
    service!.recordUsage('On'); await service!.flushTelemetry()
    expect(sent[0].body.k).toBe('provider')
    expect(listeners.mock.calls.filter(([event]) => event === 'pagehide')).toHaveLength(1)
    service!.recordUsage('On'); tree.unmount(); await settle(); expect(sent).toHaveLength(2)
    service!.recordUsage('On'); await service!.flushTelemetry(); expect(sent).toHaveLength(2)
    const old = service
    render(<ManagedProvider><Probe/></ManagedProvider>); await act(settle)
    expect(service).not.toBe(old)
    service!.recordUsage('On'); await service!.flushTelemetry(); expect(sent).toHaveLength(3)
  })
  it('seals attribution and gauges across token rotation, identity changes and logout', async () => {
    const service=client({identity:'alice',instanceId:'mint-a'} as Options); service.setGauge('cart',1);
    await service.setContext({instanceId:'mint-b'} as any); service.setGauge('cart',2);
    await service.setContext({identity:'bob'}); service.setGauge('cart',3);
    await service.setContext({identity:''}); service.setGauge('cart',4); await service.flushTelemetry();
    expect(sent.map(x=>[x.body.i,x.body.u,x.body.m.cart])).toEqual([
      ['mint-a',undefined,1],['mint-b',undefined,2],[undefined,'bob',3],[undefined,undefined,4],
    ]);
  });
  it('uses only minted targeting and isolates token caches, response-mode revisions and 304 hydration', async () => {
    const service=client({identity:'alice',instanceId:'mint-a',persistCache:true,groups:['staff'],claims:{role:'admin'}} as Options);
    await service._loadFeatures();
    const first=new URL(fetchMock.mock.calls[0][0]); expect(first.searchParams.get('i')).toBe('mint-a');
    for(const key of ['u','userId','g','claim.role']) expect(first.searchParams.has(key)).toBe(false);
    (service as any)._cacheDefinitionsRevision('revision-a');
    const aKey=(service as any)._contextCacheKey();
    definitions={On:false}; await service.setContext({instanceId:'mint-b'} as any);
    expect((service as any)._contextCacheKey()).not.toBe(aKey); expect((service as any)._definitionsRevision).toBeNull();
    fetchMock.mockResolvedValueOnce({ok:false,status:304}); await service.setContext({instanceId:'mint-a'} as any);
    expect((service as any)._features.On).toBe(true);
    const variant=client({instanceId:'mint-a',persistCache:true,enableVariants:true} as Options);
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
    service.registerContext('ReactTelemetryMapper',()=>{
      definitions={On:false}; transition=service.setContext({identity:'carol'}); return {kind:'User',key:'test',attributes:{}};
    });
    expect(await service.isFeatureOn('On',{},'ReactTelemetryMapper')).toBe(true); await transition; await service.flushTelemetry();
    expect(sent[0].body.u).toBe('bob');
  });
  it('rejects stale ABA responses and never restores a disposed context', async () => {
    const pending:Array<(value:any)=>void>=[];
    fetchMock.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    const service=client({identity:'alice'});
    const a=service.setContext({identity:'alice'}); await settle();
    const b=service.setContext({identity:'bob'}); await settle();
    const c=service.setContext({identity:'alice'}); await settle();
    expect(pending.length).toBe(3);
    const response=(defs:any)=>({ok:true,status:200,text:async()=>JSON.stringify(defs)});
    pending[2]?.(response({Current:true})); await c;
    pending[0]?.(response({Stale:true})); pending[1]?.(response({Stale:true})); await Promise.all([a,b]);
    expect((service as any)._features).toEqual({Current:true});
    const d=service.setContext({identity:'after'}); await settle(); service.dispose(); pending[3]?.(response({Resurrected:true})); await d;
    expect((service as any)._features).not.toEqual({Resurrected:true});
  });

  it('retains retry bytes and immediate post-transition events in one owner', async () => {
    jest.useFakeTimers();
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
      const service=client({identity:'alice'}); service.setGauge('cart',1); const flushing=service.flushTelemetry(); await settle();
      const reporter=(service as any)._telemetry;
      await service.setContext({identity:'bob'}); service.setGauge('cart',2); complete({status:429}); await settle();
      await jest.advanceTimersByTimeAsync(30000); await flushing; await service.flushTelemetry();
      expect((service as any)._telemetry).toBe(reporter);
      expect(sent.map(x=>[x.body.u,x.body.m.cart])).toEqual([['alice',1],['alice',1],['bob',2]]);
      expect(sent[0].init.body).toBe(sent[1].init.body);
    } finally { jest.useRealTimers(); }
  });
  it('keeps a single globally bounded reporter through 2200 context changes', async () => {
    const onError=jest.fn(); const service=client({onError}); service.recordUsage('Initial');
    const reporter=(service as any)._telemetry;
    for(let index=0;index<2200;index++) { await service.setContext({identity:`fixture-${index}`}); service.incrementCounter('orders'); }
    expect((service as any)._telemetry).toBe(reporter);
    expect(onError.mock.calls.some(args=>String(args[0]).includes('buffer-full'))).toBe(true);
    await service.flushTelemetry(); expect(sent.length).toBeGreaterThan(0); expect(sent.length).toBeLessThanOrEqual(2000);
    expect(sent.reduce((size,x)=>size+Buffer.byteLength(JSON.stringify(x.body)),0)).toBeLessThanOrEqual(262144);
  });
  it('rejects foreign owner captures, orphan revisions and delimiter collisions', async () => {
    const first=client({identity:'alice|g:staff',persistCache:true}); const second=client({identity:'alice',groups:['staff'],persistCache:true});
    expect((first as any)._contextCacheKey()).not.toBe((second as any)._contextCacheKey());
    await first._loadFeatures();
    expect((second as any)._getEffectiveFlagValue('On',undefined,(first as any)._captureEvaluation())).toBe(false);
    localStorage.clear(); localStorage.setItem('toggly:revision:telemetry-test:Production:'+(first as any)._revisionScope(),'orphan');
    expect((first as any)._definitionsRevision).toBeNull();
    first.dispose(); await first.setContext({identity:'after'}); expect((first as any)._config.identity).toBe('alice|g:staff');
  });

  it('keeps newer hook context results when an earlier evaluation finishes late', async () => {
    const service=client({identity:'alice'}); await service._loadFeatures();
    let release:()=>void=()=>{}; let first=true;
    service.addHook({getMetadata:()=>({name:'slow'}),beforeEvaluation:async()=>{
      if(first) {first=false; await new Promise<void>(resolve=>release=resolve)} return undefined;
    }} as any);
    function Probe() { const flag=useFeatureFlag('On'); return <span data-testid="context-state">{flag.isLoading?'loading':String(flag.isEnabled)}</span> }
    render(<Provider value={{toggly:service}}><Probe /></Provider>); await act(async()=>{await settle()});
    definitions={On:false}; await act(async()=>{await service.setContext({identity:'bob'}); await settle()});
    expect(screen.getByTestId('context-state')).toHaveTextContent('false');
    await act(async()=>{release(); await settle()});
    expect(screen.getByTestId('context-state')).toHaveTextContent('false');
  });
  it('withholds a superseded variant during a reentrant context refresh', async () => {
    definitions={On:{enabled:true,variant:'old'}};
    const service=client({identity:'alice',enableVariants:true}); await service._loadFeatures();
    function Probe() { const variant=useVariant('On'); return <span data-testid="context-variant">{variant?.name??'none'}</span> }
    render(<Provider value={{toggly:service}}><Probe /></Provider>); await act(async()=>{await settle()});
    let complete:(value:any)=>void=()=>{}; let transition:Promise<void>|undefined; let first=true;
    fetchMock.mockImplementationOnce(()=>new Promise(resolve=>complete=resolve));
    service.setLocalGates([{id:'reentrant',flagKeys:['On'],isEnabled:()=>{
      if(first) {first=false; transition=service.setContext({identity:'bob'})} return true;
    }}]);
    await act(async()=>{service.notifyLocalGatesChanged(); await settle()});
    expect(screen.getByTestId('context-variant')).toHaveTextContent('none');
    await act(async()=>{complete({ok:true,status:200,text:async()=>JSON.stringify({On:{enabled:true,variant:'new'}})}); await transition});
    expect(screen.getByTestId('context-variant')).toHaveTextContent('new');
  });

  it('restarts live updates after returning to a token with a cached 304 snapshot', async () => {
    const sockets:any[]=[];
    jest.spyOn(globalThis,'WebSocket').mockImplementation((()=>{
      const socket={close:jest.fn()}; sockets.push(socket); return socket;
    }) as any);
    const service=client({instanceId:'mint-a',persistCache:true,enableLiveUpdates:true}); await service._loadFeatures();
    (service as any)._cacheDefinitionsRevision('revision-a');
    await service.setContext({instanceId:'mint-b'});
    fetchMock.mockResolvedValueOnce({ok:false,status:304}); await service.setContext({instanceId:'mint-a'});
    expect(sockets).toHaveLength(3); expect((service as any)._ws).toBe(sockets[2]);
    expect(sockets[0].onmessage).toBeNull(); expect(sockets[1].onmessage).toBeNull();
  });

})
