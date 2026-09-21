import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTogglyClient } from '../src/client'
import type { TogglyClient, TogglyConfig } from '../src/types'

describe('browser compact telemetry boundary', () => {
  let clients: TogglyClient[]
  let sent: {url: string; body: any; init: RequestInit}[]
  let definitions: Record<string, unknown>
  let fetchMock: ReturnType<typeof vi.fn>
  function client(options: TogglyConfig = {}) {
    const value = createTogglyClient({appKey: 'browser', environment: 'Test', identity: 'owner', refreshInterval: 0, enableLiveUpdates: false, ...options})
    clients.push(value)
    return value
  }
  beforeEach(() => {
    clients = []; sent = []; definitions = {On: true, Off: false}
    vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', new EventTarget()); vi.stubGlobal('CompressionStream', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/frontend/telemetry')) {
        sent.push({url, init: init!, body: JSON.parse(init!.body as string)})
        return {status: 202}
      }
      return new Response(JSON.stringify({defs: definitions}), {status: 200})
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(async () => {
    clients.forEach(value => value.destroy()); await new Promise(resolve => setImmediate(resolve))
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  it('defaults browser checks on, preserves effective short circuit and never sends trusted telemetry', async () => {
    const value = client({identity: 'private-user', groups: ['private-group'], claims: {role: 'private-role'}})
    await value.init(); await value.flushTelemetry(); expect(sent).toEqual([])
    expect(await value.isFeatureOff('Off')).toBe(true)
    expect(await value.evaluateFeatureGate(['Off', 'On'], 'all', true)).toBe(true)
    expect(await value.evaluateFeatureGate(['On', 'Off'], 'any')).toBe(true)
    await value.flushTelemetry()
    expect(sent.map(x => x.body)).toEqual([{k: 'browser', e: 'Test', u: 'private-user', f: {Off: {disabled: [2]}, On: {enabled: [1]}}}])
    expect(sent[0].init.credentials).toBe('omit')
    expect(sent[0].body.u).toBe('private-user')
    expect(JSON.stringify(sent)).not.toContain('private-group')
    expect(JSON.stringify(sent)).not.toContain('private-role')
    expect(fetchMock.mock.calls.every(([url]) => !url.includes('/api/usage/') && !url.endsWith('/api/metrics'))).toBe(true)
  })
  it('retains legacy identity argument and forwards only its third variant', async () => {
    const value = client(); await value.init()
    value.recordUsage('On', 'private-user'); value.recordView('On', 'private-user', 'control')
    await value.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'browser', e: 'Test', u: 'owner', f: {On: {enabled: [0, 1], control: [0, 0, 1]}}})
  })
  it('exposes compact metrics and explicit usage without invoking flag evaluation', async () => {
    const value = client() as any
    expect(value.telemetry).toBeDefined()
    value.telemetry.recordUsage('On', 'control'); value.telemetry.recordView('On')
    value.telemetry.incrementCounter('orders'); value.telemetry.incrementCounter('orders', 2)
    value.telemetry.setGauge('cart', 9); value.telemetry.setGauge('cart', 3)
    await value.telemetry.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'browser', e: 'Test', u: 'owner', f: {On: {control: [0, 1], enabled: [0, 0, 1]}}, m: {orders: 3, cart: 3}})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('keeps unsupported measure/observation semantics out of browser payload with bounded diagnostics', async () => {
    const diagnostic = vi.fn()
    const value = client({onError: diagnostic}); await value.init()
    for (let i = 0; i < 100; i++) {
      value.measure('private-measure', 1.5, {feature: 'private-feature', variant: 'private-variant'})
      value.observe('private-observation', 7)
    }
    value.incrementCounter('orders', 2, {feature: 'private-feature', variant: 'private-variant'})
    await value.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'browser', e: 'Test', u: 'owner', m: {orders: 2}})
    expect(diagnostic.mock.calls.length).toBeGreaterThan(0)
    expect(diagnostic.mock.calls.length).toBeLessThanOrEqual(3)
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private-')
  })
  it('honors independent explicit category opt-outs', async () => {
    const usageOff = client({enableUsageTracking: false}); await usageOff.init()
    await usageOff.isFeatureOn('On'); usageOff.recordUsage('On'); usageOff.incrementCounter('orders', 2); await usageOff.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'browser', e: 'Test', u: 'owner', m: {orders: 2}})
    const metricsOff = client({enableMetrics: false}); await metricsOff.init()
    await metricsOff.isFeatureOn('On'); metricsOff.incrementCounter('orders', 2); await metricsOff.flushTelemetry()
    expect(sent[1].body).toEqual({k: 'browser', e: 'Test', u: 'owner', f: {On: {enabled: [1]}}})
  })
  it.each([{enableTelemetry: false}, {appKey: undefined}, {enableUsageTracking: false, enableMetrics: false}])('creates no reporter resources with %j', async options => {
    const timer = vi.spyOn(globalThis, 'setTimeout')
    const events = vi.spyOn(window, 'addEventListener')
    const value = client(options); await value.init(); await value.isFeatureOn('On'); value.recordUsage('On'); value.incrementCounter('orders'); await value.flushTelemetry()
    expect(sent).toEqual([]); expect(timer).not.toHaveBeenCalled(); expect(events).not.toHaveBeenCalled()
  })
  it('counts local/entity leaves once and leaves refresh snapshots silent', async () => {
    definitions = {On: true, Entity: {requirement: 'all', rules: [{property: 'role', op: 'eq', value: 'admin', type: 'string'}]}}
    const local = vi.fn(() => false)
    const value = client({localGates: [{id: 'device', flagKeys: ['On'], isEnabled: local}]}); await value.init()
    expect(await value.evaluateFeatureGate(['On', 'Entity'], 'all', true)).toBe(true)
    expect(local).toHaveBeenCalledTimes(1)
    expect(await value.isFeatureOn('Entity', {kind: 'User', key: 'secret', attributes: {role: 'admin'}})).toBe(true)
    await value.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {disabled: [1]}, Entity: {enabled: [1]}})
    sent.length = 0; await value.refresh(); await value.flushTelemetry(); expect(sent).toEqual([])
  })
  it('reinitialization flushes the old owner and does not count a retained snapshot for the new app', async () => {
    const value = client({appKey: 'old', environment: 'Old'}); await value.init(); await value.isFeatureOn('On')
    definitions = {On: false}; await value.init({appKey: 'new', environment: 'New'})
    expect(await value.isFeatureOn('On')).toBe(false); await value.flushTelemetry()
    expect(sent.map(x => x.body)).toEqual([{k: 'old', e: 'Old', u: 'owner', f: {On: {enabled: [1]}}}, {k: 'new', e: 'New', u: value.identity, f: {On: {disabled: [1]}}}])
  })
  it('discards an older initialization after a new owner has loaded the opposite value', async () => {
    let complete!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const value = client({appKey: 'old', environment: 'Old'}); const pending = value.init()
    await Promise.resolve(); definitions = {On: false}
    await value.init({appKey: 'new', environment: 'New'})
    complete(new Response(JSON.stringify({defs: {On: true}}), {status: 200})); await pending
    expect(await value.isFeatureOn('On')).toBe(false); await value.flushTelemetry()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({k: 'new', e: 'New', u: value.identity, f: {On: {disabled: [1]}}})
  })
  it.each(['identity', 'context'])('a delayed old %s hook cannot mutate the replacement owner', async method => {
    let complete!: () => void
    const pendingHook = new Promise<void>(resolve => {complete = resolve})
    const value = client({appKey: 'old', identity: 'old-user', hooks: [{getMetadata: () => ({name: 'delayed'}), beforeIdentify: () => pendingHook}]})
    await value.init()
    const pending = method === 'identity' ? value.setIdentity('late-old-user') : value.setContext({identity: 'late-old-user', groups: ['old-group']})
    await Promise.resolve(); definitions = {On: false}
    await value.init({appKey: 'new', environment: 'New', identity: 'new-user'})
    complete(); await pending
    expect(value.identity).toBe('new-user')
    expect(value.config.groups).toBeUndefined()
    expect(await value.isFeatureOn('On')).toBe(false); await value.flushTelemetry()
    expect(sent[0].body).toEqual({k: 'new', e: 'New', u: value.identity, f: {On: {disabled: [1]}}})
  })
  it('browser SSR entry never starts a reporter or background definition resources', async () => {
    vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined)
    const {createTogglyClient: createBrowserClient} = await import('../src/browser')
    const interval = vi.spyOn(globalThis, 'setInterval')
    const value = createBrowserClient({appKey: 'server', refreshInterval: 1000}); clients.push(value)
    value.telemetry.recordUsage('On'); value.telemetry.recordView('On'); value.telemetry.incrementCounter('orders'); value.telemetry.setGauge('cart', 3)
    await value.init(); await value.flushTelemetry()
    expect(sent).toEqual([]); expect(interval).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('local definition hydration stays silent while public cached evaluation records the effective result', async () => {
    const value = client({evaluationMode: 'local', localGates: [{id: 'device', flagKeys: ['On'], isEnabled: () => false}]})
    value.hydrateDefinitions([{featureKey: 'On', filters: [{name: 'AlwaysOn', parameters: {}}]}])
    await value.flushTelemetry(); expect(sent).toEqual([])
    expect(await value.isFeatureOn('On')).toBe(false); await value.flushTelemetry()
    expect(sent[0].body.f).toEqual({On: {disabled: [1]}}); expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('cannot resurrect definition timers or sockets after disposal during initialization', async () => {
    let complete!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
    const timer = vi.spyOn(globalThis, 'setInterval')
    const socket = vi.fn()
    const value = client({refreshInterval: 30000, enableLiveUpdates: true, webSocketImpl: socket as any})
    const pending = value.init(); await Promise.resolve(); value.destroy()
    complete(new Response(JSON.stringify({defs: {On: true}}), {status: 200})); await pending
    expect(timer).not.toHaveBeenCalled(); expect(socket).not.toHaveBeenCalled()
  })
  it('routes minted definitions exclusively and retains attribution across immediate transitions', async () => {
    const value = client({identity: 'alice', instanceId: 'mint-a', groups: ['staff'], claims: {role: 'admin'}} as TogglyConfig)
    await value.init()
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('i')).toBe('mint-a')
    expect(url.searchParams.has('u')).toBe(false)
    expect(url.searchParams.has('g')).toBe(false)
    expect([...url.searchParams.keys()].some(k => k.startsWith('claim.'))).toBe(false)
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('x-toggly-identity')
    value.recordUsage('On', 'ignored', 'control')
    await value.setContext({instanceId: 'mint-b'} as any)
    value.recordView('On', 'ignored', 'treatment')
    await value.setIdentity('bob')
    value.incrementCounter('orders', 2)
    await value.flushTelemetry()
    expect(sent.map(x => x.body)).toEqual([
      {k:'browser',e:'Test',i:'mint-a',f:{On:{control:[0,1]}}},
      {k:'browser',e:'Test',i:'mint-b',f:{On:{treatment:[0,0,1]}}},
      {k:'browser',e:'Test',u:'bob',m:{orders:2}},
    ])
  })
  it('records a reentrant local gate under its captured owner attribution', async () => {
    let pending: Promise<void> | undefined
    const value = client({identity:'alice', localGates:[{id:'rotate',flagKeys:['On'],isEnabled:()=>{pending=value.setContext({instanceId:'mint-b'} as any); return true}}]})
    await value.init()
    expect(await value.isFeatureOn('On')).toBe(true)
    await pending
    value.recordUsage('On')
    await value.flushTelemetry()
    expect(sent.map(x=>x.body)).toEqual([{k:'browser',e:'Test',u:'alice',f:{On:{enabled:[1]}}},{k:'browser',e:'Test',i:'mint-b',f:{On:{enabled:[0,1]}}}])
  })
  it('rejects failed token refresh without resurrecting retired identity or definitions', async () => {
    const value=client({identity:'alice',instanceId:'mint-a',featureDefaults:{On:false}} as TogglyConfig)
    await value.init(); expect(value.state.features.On).toBe(true)
    fetchMock.mockRejectedValueOnce(Error('offline'))
    await expect(value.setContext({instanceId:'mint-b'} as any)).rejects.toThrow('offline')
    expect((value.config as any).instanceId).toBe('mint-b')
    expect(value.state.features.On).toBe(false)
    await value.isFeatureOn('On'); await value.flushTelemetry()
    expect(sent[0].body).toEqual({k:'browser',e:'Test',i:'mint-b',f:{On:{disabled:[1]}}})
  })
  it('fences late old-token responses and never reuses their revisions for another token', async () => {
    const value=client({instanceId:'mint-a'} as TogglyConfig)
    await value.init()
    let complete!: (response:Response)=>void
    fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
    const old=value.refresh(); await Promise.resolve()
    definitions={On:false}; await value.setContext({instanceId:'mint-b'} as any)
    const request=fetchMock.mock.calls.at(-1)!
    expect(new URL(request[0]).searchParams.get('i')).toBe('mint-b')
    expect(request[1]?.headers).not.toHaveProperty('If-None-Match')
    complete(new Response(JSON.stringify({defs:{On:true}}),{status:200,headers:{etag:'old'}})); await old
    expect(value.state.features.On).toBe(false)
  })

  it('hydrates persisted token A after B with its matching 304 revision and flags', async () => {
    const storage=new Map<string,string>()
    vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)})
    fetchMock.mockImplementationOnce(async()=>new Response(JSON.stringify({defs:{On:true}}),{status:200,headers:{etag:'rev-a'}}))
    const first=client({instanceId:'mint-a',persistFeatures:true} as TogglyConfig); await first.init(); first.destroy()
    const value=client({instanceId:'mint-b',persistFeatures:true,featureDefaults:{On:false}} as TogglyConfig)
    definitions={On:false}; await value.init()
    fetchMock.mockImplementationOnce(async (_url,init)=>{
      expect(init.headers['If-None-Match']).toBe('rev-a')
      return new Response(null,{status:304,headers:{etag:'rev-a'}})
    })
    await value.setContext({instanceId:'mint-a'} as any)
    expect(value.state.features.On).toBe(true)
    expect(await value.isFeatureOn('On')).toBe(true)
    fetchMock.mockImplementationOnce(async()=>new Response(null,{status:304,headers:{etag:'rev-a'}}))
    expect(await value.refresh()).toEqual({On:true})
    fetchMock.mockRejectedValueOnce(Error('offline'))
    await expect(value.setContext({instanceId:'mint-c'} as any)).rejects.toThrow('offline')
    expect(value.state.features.On).toBe(false)
  })
  it('rejects orphan persisted revisions and isolates response modes', async () => {
    const storage=new Map<string,string>()
    vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)})
    const first=client({instanceId:'mint-a',persistFeatures:true} as TogglyConfig); await first.init(); first.destroy()
    for(const key of storage.keys()) storage.set(key,JSON.stringify({revision:'orphan'}))
    fetchMock.mockImplementationOnce(async(_url,init)=>{
      expect(init.headers).not.toHaveProperty('If-None-Match')
      return new Response(null,{status:304})
    })
    const second=client({instanceId:'mint-a',persistFeatures:true,featureDefaults:{On:false}} as TogglyConfig); await second.init()
    expect(second.state.features.On).toBe(false); expect(second.state.error).toBeInstanceOf(Error)
    fetchMock.mockImplementationOnce(async(_url,init)=>{
      expect(init.headers).not.toHaveProperty('If-None-Match')
      return new Response(JSON.stringify([{featureKey:'On',filters:[{name:'AlwaysOn',parameters:{}}]}]),{status:200})
    })
    await second.init({evaluationMode:'local'}); expect(await second.isFeatureOn('On')).toBe(true)
  })
  it('includes generated identities and clears a token to the owner fallback', async () => {
    const value=client({identity:undefined,instanceId:'mint-a'} as TogglyConfig); await value.init()
    expect(value.identity).toMatch(/^[a-f0-9-]{36}$/)
    await value.setContext({instanceId:''} as any); value.recordUsage('On','ignored','control'); await value.flushTelemetry()
    expect(sent[0].body).toEqual({k:'browser',e:'Test',u:value.identity,f:{On:{control:[0,1]}}})
  })

  it.each(['hook', 'mapper', 'gate'])('captures evaluated flags and attribution before reentrant %s callbacks', async kind => {
    definitions={On:true,Second:true}
    const value=client({identity:'alice'}); await value.init()
    let transition:Promise<void>|undefined
    const rotate=()=>{definitions={On:false,Second:false}; transition=value.setContext({identity:'bob'}); return true}
    if(kind==='hook') value.addHook({getMetadata:()=>({name:'rotate'}),beforeEvaluation:async()=>{rotate(); await transition}})
    if(kind==='mapper') value.registerContext('NextReentrantMapper',()=>{rotate(); return {kind:'User',key:'fixture',attributes:{}}})
    if(kind==='gate') value.setLocalGates([{id:'rotate',flagKeys:['On'],isEnabled:rotate}])
    expect(kind==='gate' ? await value.evaluateFeatureGate(['On','Second'],'all')
      : await value.isFeatureOn('On',kind==='mapper'?{}:undefined,kind==='mapper'?'NextReentrantMapper':undefined)).toBe(true)
    await transition; value.recordUsage('New'); await value.flushTelemetry()
    expect(sent.filter(x=>x.body.u==='alice').map(x=>x.body.f)).toEqual(kind==='gate'?[{On:{enabled:[1]}},{Second:{enabled:[1]}}]:[{On:{enabled:[1]}}])
    expect(sent.find(x=>x.body.u==='bob')?.body.f).toEqual({New:{enabled:[0,1]}})
  })
  it('bounds persisted context snapshots and never offers an evicted revision', async () => {
    const storage=new Map<string,string>()
    vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)})
    fetchMock.mockImplementation(async(url,init)=>url.includes('/api/frontend/telemetry')?{status:202}
      :new Response(JSON.stringify({defs:{On:true}}),{status:200,headers:{etag:new URL(url).searchParams.get('i')!}}))
    const value=client({instanceId:'token-0',persistFeatures:true,enableTelemetry:false}); await value.init()
    for(let index=1;index<=12;index++) await value.setContext({instanceId:`token-${index}`})
    expect(storage.size).toBe(1)
    expect(JSON.stringify([...storage.values()])).not.toContain('token-0')
    value.destroy()
    fetchMock.mockImplementationOnce(async(_url,init)=>{
      expect(init.headers).not.toHaveProperty('If-None-Match')
      return new Response(null,{status:304})
    })
    const evicted=client({instanceId:'token-0',persistFeatures:true,enableTelemetry:false,featureDefaults:{On:false}})
    expect(await evicted.init()).toEqual({On:false}); expect(await evicted.isFeatureOn('On')).toBe(false)
    expect(evicted.state.error).toBeInstanceOf(Error)
    fetchMock.mockImplementationOnce(async(_url,init)=>{
      expect(init.headers['If-None-Match']).toBe('token-12'); return new Response(null,{status:304})
    })
    const retained=client({instanceId:'token-12',persistFeatures:true,enableTelemetry:false,featureDefaults:{On:false}})
    expect(await retained.init()).toEqual({On:true}); expect(await retained.isFeatureOn('On')).toBe(true)
  })
  it('retains the eight-context in-memory bound without orphan conditional requests', async () => {
    fetchMock.mockImplementation(async url=>new Response(JSON.stringify({defs:{On:true}}),{status:200,headers:{etag:new URL(url).searchParams.get('i')!}}))
    const value=client({instanceId:'token-0',enableTelemetry:false,featureDefaults:{On:false}}); await value.init()
    for(let index=1;index<=8;index++) await value.setContext({instanceId:`token-${index}`})
    fetchMock.mockImplementationOnce(async(_url,init)=>{
      expect(init.headers).not.toHaveProperty('If-None-Match'); return new Response(null,{status:304})
    })
    await expect(value.setContext({instanceId:'token-0'})).rejects.toThrow('without a matching snapshot')
    expect(await value.isFeatureOn('On')).toBe(false)
  })
  it.each(['context', 'setter'])('restarts local-mode live resources after a %s change', async method => {
    const sockets:any[]=[]
    const Socket=vi.fn(function(){const socket={onopen:null,onmessage:null,onclose:null,onerror:null,close:vi.fn()};sockets.push(socket);return socket})
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{featureKey:'On',filters:[{name:'AlwaysOn',parameters:{}}]}]),{status:200}))
    const value=client({evaluationMode:'local',enableLiveUpdates:true,webSocketImpl:Socket as any,enableTelemetry:false})
    await value.init(); expect(sockets).toHaveLength(1)
    if(method==='context') await value.setContext({identity:'bob'}); else value.identity='bob'
    expect(sockets[0].close).toHaveBeenCalled(); expect(sockets).toHaveLength(2)
    expect(await value.isFeatureOn('On')).toBe(true)
  })

})
