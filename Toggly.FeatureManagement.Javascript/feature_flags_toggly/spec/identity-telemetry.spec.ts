import { Toggly } from '../lib/toggly';
import { StorageKeys } from '../lib/models';
import { gunzipSync } from 'zlib';

const SDK = Toggly as typeof Toggly & { instanceId: string };
let requests: Array<{ url: URL; init?: RequestInit }>;
const response = (defs: object, revision = '') => ({ ok: true, status: 200, headers: { get: (name: string) => name.toLowerCase() === 'etag' ? revision : null }, json: async () => ({ defs }) } as Response);
const bodies = () => requests.filter(r => r.url.pathname.endsWith('/api/frontend/telemetry')).map(r => JSON.parse(typeof r.init!.body === 'string' ? r.init!.body : gunzipSync(Buffer.from(r.init!.body as ArrayBuffer)).toString()));
const definitions = () => requests.filter(r => r.url.pathname.includes('evaluated'));
async function init(extra: Record<string, unknown> = {}) {
  await SDK.init({ appKey: 'identity-app', identity: '', groups: [], claims: {}, persistCache: true, enableLiveUpdates: false, featureFlagsRefreshInterval: 0, ...extra });
}
async function settled() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
beforeEach(() => {
  SDK.cancelRefreshInterval(); localStorage.clear(); requests = [];
  global.fetch = jest.fn(async (url, options) => {
    requests.push({url: new URL(String(url)), init: options});
    return String(url).includes('/api/frontend/telemetry') ? { status: 202 } as Response : response({ Flag: true }, 'old-revision');
  });
});
afterEach(() => { SDK.cancelRefreshInterval(); jest.useRealTimers(); });

test.each([false, true])('minted definitions suppress client targeting, separate token cache and revisions (variants %s)', async enableVariants => {
  await init({ identity: 'alice', groups: ['admin'], claims: { plan: 'pro' }, instanceId: 'token/one', enableVariants });
  const first = definitions()[0].url.searchParams;
  expect(first.get('i')).toBe('token/one');
  expect(Array.from(first.keys()).filter(k => k === 'u' || k === 'g' || k.startsWith('claim.'))).toEqual([]);
  await SDK.refresh(); expect((definitions()[1].init!.headers as Record<string,string>)['If-None-Match']).toBe('old-revision');
  SDK.instanceId = 'token/two';
  expect(SDK.featureFlagsValue).toEqual({});
  await SDK.refresh();
  expect(definitions()[2].url.searchParams.get('i')).toBe('token/two');
  expect((definitions()[2].init!.headers as Record<string,string>)['If-None-Match']).toBeUndefined();
  SDK.instanceId = '';
  await SDK.refresh(); const fallback = definitions()[3].url.searchParams;
  expect(fallback.get('i')).toBeNull(); expect(fallback.get(enableVariants ? 'userId' : 'u')).toBe('alice'); expect(fallback.get('g')).toBe('admin'); expect(fallback.get('claim.plan')).toBe('pro');
  expect((definitions()[3].init!.headers as Record<string,string>)['If-None-Match']).toBeUndefined();
});

const mintedCacheKeys = (token: string, enableVariants: boolean) => {
  const context = `i:${encodeURIComponent(token)}`;
  return {
    flags: StorageKeys.flagsCacheKey('identity-app', 'Production', `v3:${enableVariants ? 'variants' : 'evaluated'}:${context}`),
    variants: StorageKeys.variantsCacheKey('identity-app', 'Production', context),
    revision: StorageKeys.definitionsRevisionCacheKey('identity-app', 'Production', `v2:${enableVariants ? 'variants' : 'evaluated'}:${context}`),
  };
};

function tokenDefinitions(enableVariants: boolean, enabled: boolean) {
  return enableVariants ? { Flag: { enabled, variant: enabled ? 'blue' : 'red', configurationValue: enabled ? 'A' : 'B' } } : { Flag: enabled };
}

function mockTokenDefinitions(enableVariants: boolean) {
  global.fetch = jest.fn(async (url, options) => {
    const parsed = new URL(String(url));
    requests.push({ url: parsed, init: options });
    const token = parsed.searchParams.get('i');
    const revision = `${token}-${enableVariants ? 'variants' : 'evaluated'}`;
    if ((options?.headers as Record<string, string>)?.['If-None-Match'] === revision) {
      return { ok: false, status: 304, headers: { get: () => null }, json: jest.fn(() => { throw new Error('304 has no body'); }) } as unknown as Response;
    }
    return response(tokenDefinitions(enableVariants, token === 'token/A'), revision);
  });
}

test.each([false, true])('persisted token A -> B -> A hydrates matching definitions on 304 (variants %s)', async enableVariants => {
  mockTokenDefinitions(enableVariants);
  await init({ instanceId: 'token/A', enableVariants, enableTelemetry: false, flagDefaults: { Default: true } });
  const keys = mintedCacheKeys('token/A', enableVariants);
  expect(localStorage.getItem(keys.revision)).toBe(`token/A-${enableVariants ? 'variants' : 'evaluated'}`);
  expect(JSON.parse(localStorage.getItem(keys.flags)!)).toEqual({ Flag: true });
  SDK.instanceId = 'token/B';
  await SDK.refresh();
  expect(SDK.featureFlagsValue).toEqual({ Flag: false });
  // A fresh initialization clears all in-memory definitions/revision state.
  await init({ instanceId: 'token/A', enableVariants, enableTelemetry: false, flagDefaults: { Default: true } });
  expect(definitions().map(request => request.url.searchParams.get('i'))).toEqual(['token/A', 'token/B', 'token/A']);
  expect(definitions().map(request => (request.init!.headers as Record<string, string>)['If-None-Match'])).toEqual([undefined, undefined, `token/A-${enableVariants ? 'variants' : 'evaluated'}`]);
  expect(SDK.featureFlagsValue).toEqual({ Flag: true });
  expect(SDK.isFeatureOn('Flag')).toBe(true);
  if (enableVariants) expect(SDK.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 'A' });
});

test.each([
  { enableVariants: false, missing: 'flags' as const },
  { enableVariants: true, missing: 'flags' as const },
  { enableVariants: true, missing: 'variants' as const },
])('returning to token A rejects an orphan revision without $missing (variants $enableVariants)', async ({ enableVariants, missing }) => {
  mockTokenDefinitions(enableVariants);
  await init({ instanceId: 'token/A', enableVariants, enableTelemetry: false });
  const keys = mintedCacheKeys('token/A', enableVariants);
  SDK.instanceId = 'token/B';
  await SDK.refresh();
  localStorage.removeItem(keys[missing]);
  expect(localStorage.getItem(keys.revision)).not.toBeNull();
  await init({ instanceId: 'token/A', enableVariants, enableTelemetry: false });
  expect((definitions()[2].init!.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
  expect(SDK.featureFlagsValue).toEqual({ Flag: true });
  if (enableVariants) expect(SDK.getVariant('Flag')?.name).toBe('blue');
});

test.each([false, true])('returning to token A never reuses the other response mode revision (original variants %s)', async originalVariants => {
  mockTokenDefinitions(originalVariants);
  await init({ instanceId: 'token/A', enableVariants: originalVariants, enableTelemetry: false });
  const keys = mintedCacheKeys('token/A', originalVariants);
  expect(localStorage.getItem(keys.revision)).not.toBeNull();
  mockTokenDefinitions(!originalVariants);
  await init({ instanceId: 'token/B', enableVariants: !originalVariants, enableTelemetry: false });
  await init({ instanceId: 'token/A', enableVariants: !originalVariants, enableTelemetry: false });
  expect((definitions()[2].init!.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
  expect(SDK.featureFlagsValue).toEqual({ Flag: true });
  if (!originalVariants) expect(SDK.getVariant('Flag')?.name).toBe('blue');
});

test('queued counters and gauges keep immutable anonymous, identity and minted attribution through logout', async () => {
  await init(); SDK.incrementCounter('orders', 1); SDK.setGauge('cart', 1);
  SDK.identity = 'alice'; await settled(); SDK.incrementCounter('orders', 2); SDK.setGauge('cart', 2);
  SDK.identity = 'bob'; await settled(); SDK.incrementCounter('orders', 3);
  SDK.instanceId = 'mint-one'; await settled(); SDK.recordUsage('Use');
  SDK.instanceId = 'mint-two'; await settled(); SDK.recordView('View');
  SDK.instanceId = ''; await settled(); SDK.incrementCounter('fallback', 1);
  await SDK.clearContext(); await settled(); SDK.recordUsage('Logout'); await SDK.flushTelemetry();
  expect(bodies()).toEqual([
    { k:'identity-app', e:'Production', m:{orders:1,cart:1} },
    { k:'identity-app', e:'Production', u:'alice', m:{orders:2,cart:2} },
    { k:'identity-app', e:'Production', u:'bob', m:{orders:3} },
    { k:'identity-app', e:'Production', i:'mint-one', f:{Use:{enabled:[0,1]}} },
    { k:'identity-app', e:'Production', i:'mint-two', f:{View:{enabled:[0,0,1]}} },
    { k:'identity-app', e:'Production', u:'bob', m:{fallback:1} },
    { k:'identity-app', e:'Production', f:{Logout:{enabled:[0,1]}} },
  ]);
});

test('identity changes invalidate old pending bodies and clear old snapshot immediately', async () => {
  await init({ identity: 'alice' });
  let finish!: (value: string) => void;
  (global.fetch as jest.Mock).mockImplementationOnce(async (url, options) => { requests.push({url:new URL(String(url)),init:options}); return { ok:true,status:200,headers:{get:()=> 'late-old'},text:()=>new Promise(resolve=>{finish=resolve}) }; });
  const old = SDK.refresh(); await settled();
  SDK.identity = 'bob'; expect(SDK.featureFlagsValue).toEqual({});
  (global.fetch as jest.Mock).mockImplementationOnce(async (url, options) => { requests.push({url:new URL(String(url)),init:options}); return response({Flag:false}, 'new-revision'); });
  await SDK.refresh(); finish(JSON.stringify({defs:{Flag:true}})); await old;
  expect(SDK.isFeatureOn('Flag')).toBe(false); await SDK.flushTelemetry();
  expect(bodies()).toEqual([{k:'identity-app',e:'Production',u:'bob',f:{Flag:{disabled:[1]}}}]);
  expect((definitions()[2].init!.headers as Record<string,string>)['If-None-Match']).toBeUndefined();
});

test('generated identity is forwarded only as u and never in metrics URL or private headers', async () => {
  await SDK.init({ appKey:'generated', groups:['secret'], claims:{plan:'secret'}, enableLiveUpdates:false, featureFlagsRefreshInterval:0 });
  expect(SDK.identity).toMatch(/^[\da-f-]{36}$/); SDK.recordUsage('Use'); await SDK.flushTelemetry();
  expect(bodies()[0]).toEqual({k:'generated',e:'Production',u:SDK.identity,f:{Use:{enabled:[0,1]}}});
  const packet=requests.find(r=>r.url.pathname.endsWith('/api/frontend/telemetry'))!;
  expect(packet.url.search).toBe(''); expect(packet.init!.credentials).toBe('omit');
  expect(Object.keys(packet.init!.headers!)).toEqual(['Content-Type']);
});

test('blank token falls back to identity and clearing identity clears an active token', async () => {
  await init({identity:'alice',instanceId:'   '}); SDK.recordUsage('Fallback'); await SDK.flushTelemetry();
  expect(bodies()[0].u).toBe('alice'); expect(bodies()[0].i).toBeUndefined();
  SDK.instanceId='mint'; SDK.clearIdentity(); SDK.recordUsage('Logout'); await SDK.flushTelemetry();
  expect(SDK.instanceId).toBe(''); expect(bodies()[1]).toEqual({k:'identity-app',e:'Production',f:{Logout:{enabled:[0,1]}}});
});

test('an in-flight old envelope and its queued gauge never move to a new identity', async () => {
  let finish!: (value: Response) => void;
  const transport=global.fetch;
  global.fetch=jest.fn((url, options)=>{
    if(String(url).endsWith('/api/frontend/telemetry') && !finish) {
      requests.push({url:new URL(String(url)),init:options});
      return new Promise<Response>(resolve=>{finish=resolve});
    }
    return transport(url,options);
  });
  await init({identity:'alice'});
  SDK.setGauge('cart', 1); const old=SDK.flushTelemetry(); await settled();
  SDK.setGauge('cart', 2); SDK.identity='bob';
  SDK.setGauge('cart', 3); const current=SDK.flushTelemetry();
  finish({status:202} as Response); await old; await current; await settled();
  expect(bodies().filter(body=>body.u==='alice').map(body=>body.m.cart)).toEqual([1,2]);
  expect(bodies().filter(body=>body.u==='bob').map(body=>body.m.cart)).toEqual([3]);
});

test('scheduled retry preserves its old attribution while new events belong to the new identity', async () => {
  jest.useFakeTimers();
  const transport=global.fetch; let rejected=false;
  global.fetch=jest.fn((url,options)=>{
    if(String(url).endsWith('/api/frontend/telemetry')&&!rejected) { rejected=true;requests.push({url:new URL(String(url)),init:options});return Promise.resolve({status:503} as Response); }
    return transport(url,options);
  });
  await init({identity:'alice'});
  SDK.recordUsage('Old'); const old=SDK.flushTelemetry(); await settled();
  SDK.identity='bob'; SDK.recordUsage('New'); const current=SDK.flushTelemetry();
  jest.advanceTimersByTime(30000); await settled(); await old; await current;
  expect(bodies()).toEqual([
    {k:'identity-app',e:'Production',u:'alice',f:{Old:{enabled:[0,1]}}},
    {k:'identity-app',e:'Production',u:'alice',f:{Old:{enabled:[0,1]}}},
    {k:'identity-app',e:'Production',u:'bob',f:{New:{enabled:[0,1]}}},
  ]);
});

test('returning to a minted cache never reuses a client-context cache with the same token string', async () => {
  await init({identity:'same',instanceId:'same'});
  SDK.instanceId=''; expect(SDK.featureFlagsValue).toEqual({});
  (global.fetch as jest.Mock).mockImplementationOnce(async()=>response({Flag:false},'client-revision'));
  await SDK.refresh(); expect(SDK.isFeatureOn('Flag')).toBe(false);
  SDK.instanceId='same'; expect(SDK.featureFlagsValue).toEqual({Flag:true});
  await SDK.refresh(); expect((definitions()[definitions().length-1].init!.headers as Record<string,string>)['If-None-Match']).toBe('old-revision');
});

test('reinitializing with another token discards the previous websocket revision pin', async () => {
  await init({instanceId:'first-token'}); SDK._pendingDefinitionsPin='first-only-revision';
  await init({instanceId:'second-token'});
  const query=definitions()[1].url.searchParams;
  expect(query.get('i')).toBe('second-token'); expect(query.has('rev')).toBe(false);
});

test('compatible reinitialization retains one ordered queue without final sends', async () => {
  await init({identity:'alice'}); SDK.setGauge('cart',1);
  await init({appKey:'other-app',environment:'Staging',identity:'bob'}); SDK.setGauge('cart',2);
  expect(bodies()).toEqual([]); await SDK.flushTelemetry();
  expect(bodies()).toEqual([
    {k:'identity-app',e:'Production',u:'alice',m:{cart:1}},
    {k:'other-app',e:'Staging',u:'bob',m:{cart:2}},
  ]);
});

test('transport replacement cancels an active request before the new owner can send', async () => {
  const transport=global.fetch;
  let oldSignal: AbortSignal | undefined;
  global.fetch=jest.fn((url,options)=>{
    if(String(url).startsWith('https://old-metrics.test')) { oldSignal=options?.signal as AbortSignal; requests.push({url:new URL(String(url)),init:options});return new Promise<Response>(()=>{}); }
    return transport(url,options);
  });
  await init({identity:'alice',metricsBaseUrl:'https://old-metrics.test'}); SDK.recordUsage('Old');const old=SDK.flushTelemetry();await settled();
  await init({identity:'bob',metricsBaseUrl:'https://new-metrics.test'});
  expect(oldSignal?.aborted).toBe(true); await old;
  SDK.recordUsage('New');await SDK.flushTelemetry();
  expect(bodies().map(b=>[b.u,Object.keys(b.f)])).toEqual([['alice',['Old']],['bob',['New']]]);
});

test('reinitialization cancels a prior explicit disposal final request', async () => {
  const transport=global.fetch;let oldSignal:AbortSignal|undefined;
  global.fetch=jest.fn((url,options)=>{
    if(String(url).startsWith('https://retired.test')) {oldSignal=options?.signal as AbortSignal;return new Promise<Response>(()=>{});}
    return transport(url,options);
  });
  await init({metricsBaseUrl:'https://retired.test'});SDK.recordUsage('Old');SDK.cancelRefreshInterval();await settled();
  SDK.cancelRefreshInterval();expect(oldSignal?.aborted).toBe(false);
  await init({identity:'bob'});expect(oldSignal?.aborted).toBe(true);
  SDK.recordUsage('New');await SDK.flushTelemetry();expect(bodies()[0].u).toBe('bob');
});

test('keyless pause and reactivation rebind lifecycle; opt-out discards pending data', async () => {
  await init({identity:'alice'});SDK.recordUsage('Old');
  await init({appKey:'',identity:'bob'});SDK.recordUsage('Ignored');window.dispatchEvent(new Event('pagehide'));await settled();expect(bodies()).toEqual([]);
  await init({appKey:'resumed',identity:'bob'});SDK.recordUsage('New');window.dispatchEvent(new Event('pagehide'));await SDK.flushTelemetry();
  expect(bodies().map(b=>[b.k,b.u,Object.keys(b.f)])).toEqual([['identity-app','alice',['Old']],['resumed','bob',['New']]]);
  SDK.recordUsage('Discard');await init({enableTelemetry:false});SDK.recordUsage('Ignored');await SDK.flushTelemetry();expect(bodies()).toHaveLength(2);
});

test.each(['local','mapper','hook'])('reentrant %s evaluation records the captured owner and assigned variant', async path => {
  const transport=global.fetch;
  global.fetch=jest.fn((url,options)=>String(url).includes('evaluated-variants') ? Promise.resolve(response({Flag:{enabled:true,variant:'Old',configurationValue:42}})) : transport(url,options));
  await init({identity:'alice',enableVariants:true});
  const change=()=>{SDK.identity='bob';SDK.recordUsage('NewContext')};
  if(path==='local') SDK.setLocalGates([{id:'change-owner',flagKeys:['Flag'],isEnabled:()=>{change();return true}}]);
  if(path==='mapper') SDK.registerContext('IdentitySwitch',()=>{change();return {kind:'IdentitySwitch',key:'entity',attributes:{}}});
  if(path==='hook') SDK.addHook({getMetadata:()=>({name:'identity-switch'}),beforeEvaluation:()=>{change()}});
  try {
    const value=path==='local'?SDK.getVariantValue('Flag'):SDK.isFeatureOn('Flag',path==='mapper'?{}:undefined,path==='mapper'?'IdentitySwitch':undefined);
    expect(value).toBe(path==='local'?42:true);await SDK.flushTelemetry();
    expect(bodies()).toEqual([
      {k:'identity-app',e:'Production',u:'bob',f:{NewContext:{enabled:[0,1]}}},
      {k:'identity-app',e:'Production',u:'alice',f:{Flag:{Old:[1]}}},
    ]);
  } finally {SDK.setLocalGates([]);SDK.removeHook('identity-switch')}
});

test('captured evaluation cannot send after a gate disposes its owner', async () => {
  await init({identity:'alice'});SDK.setLocalGates([{id:'dispose',flagKeys:['Flag'],isEnabled:()=>{SDK.cancelRefreshInterval();return true}}]);
  try {expect(SDK.isFeatureOn('Flag')).toBe(true);await SDK.flushTelemetry();await settled();expect(bodies()).toEqual([])} finally {SDK.setLocalGates([])}
});

test('one gate evaluation keeps all leaf variants and attribution when the first leaf changes identity', async () => {
  const transport=global.fetch;
  global.fetch=jest.fn((url,options)=>String(url).includes('evaluated-variants') ? Promise.resolve(response({First:{enabled:true,variant:'FirstOld'},Second:{enabled:true,variant:'SecondOld'}})) : transport(url,options));
  await init({identity:'alice',enableVariants:true});
  SDK.setLocalGates([{id:'switch-first',flagKeys:['First'],isEnabled:()=>{SDK.identity='bob';return true}}]);
  try {
    expect(SDK.evaluateFeatureGate(['First','Second'])).toBe(true);await SDK.flushTelemetry();
    expect(bodies().flatMap(b=>Object.entries(b.f).map(([key,value])=>[b.u,key,value]))).toEqual([
      ['alice','First',{FirstOld:[1]}],['alice','Second',{SecondOld:[1]}],
    ]);
    SDK.recordUsage('After');await SDK.flushTelemetry();expect(bodies()[bodies().length-1].u).toBe('bob');
  } finally {SDK.setLocalGates([])}
});

test('compatible reinit inside a local gate preserves the evaluated owner and returned variant', async () => {
  const transport=global.fetch;
  global.fetch=jest.fn((url,options)=>String(url).includes('evaluated-variants') ? Promise.resolve(response({Flag:{enabled:true,variant:'Old',configurationValue:42}})) : transport(url,options));
  await init({identity:'alice',enableVariants:true});let replacement:Promise<void>|undefined;
  SDK.setLocalGates([{id:'reinit',flagKeys:['Flag'],isEnabled:()=>{replacement=init({appKey:'replacement',environment:'Test',identity:'bob'});return true}}]);
  try {
    expect(SDK.getVariantValue('Flag')).toBe(42);await replacement;SDK.recordUsage('New');await SDK.flushTelemetry();
    expect(bodies()).toEqual([
      {k:'identity-app',e:'Production',u:'alice',f:{Flag:{Old:[1]}}},
      {k:'replacement',e:'Test',u:'bob',f:{New:{enabled:[0,1]}}},
    ]);
  } finally {SDK.setLocalGates([])}
});

test('rapid attribution changes share one scheduler and the global byte budget', async () => {
  jest.useFakeTimers();const diagnostics:string[]=[];
  await init({onError:(message:string)=>diagnostics.push(message)});
  for(let i=0;i<500;i++) {SDK.identity=`${i}-`+'x'.repeat(2000);SDK.incrementCounter('accepted',1)}
  expect(jest.getTimerCount()).toBe(1);expect(bodies()).toEqual([]);
  await SDK.flushTelemetry();const packets=bodies();
  expect(packets.length).toBeGreaterThan(50);expect(packets.length).toBeLessThan(150);
  expect(packets.reduce((bytes,packet)=>bytes+Buffer.byteLength(JSON.stringify(packet)),0)).toBeLessThanOrEqual(262144);
  expect(packets.every(packet=>Buffer.byteLength(JSON.stringify(packet))<=49152)).toBe(true);
  expect(packets.map(packet=>Number(packet.u.split('-')[0]))).toEqual(Array.from({length:packets.length},(_,i)=>i));
  expect(packets.every(packet=>packet.m.accepted===1)).toBe(true);
  expect(diagnostics).toEqual(Array(10).fill('Frontend telemetry: buffer-full'));
  expect(jest.getTimerCount()).toBe(1);
});

test('rapid transport replacements abort each previous owner and leave no timers after opt-out', async () => {
  jest.useFakeTimers();const signals:AbortSignal[]=[];
  global.fetch=jest.fn(async(url,options)=>{
    if(String(url).includes('/api/frontend/telemetry')) {signals.push(options!.signal as AbortSignal);return new Promise<Response>(()=>{})}
    return response({Flag:true});
  });
  let previous:Promise<void>|undefined;
  for(let index=0;index<20;index++) {
    await init({metricsBaseUrl:`https://transport-${index}.test`});await previous;
    SDK.recordUsage('Use');previous=SDK.flushTelemetry();await settled();
    expect(signals.filter(signal=>!signal.aborted)).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(2);
  }
  await init({enableTelemetry:false});await previous;
  expect(signals.every(signal=>signal.aborted)).toBe(true);expect(jest.getTimerCount()).toBe(0);
});

test('reentrant incompatible reinit keeps the result but cannot record on the replacement reporter', async () => {
  await init({identity:'alice'});let replacement:Promise<void>|undefined;
  SDK.setLocalGates([{id:'replace',flagKeys:['Flag'],isEnabled:()=>{replacement=init({identity:'bob',metricsBaseUrl:'https://replacement.test'});return true}}]);
  try {
    expect(SDK.isFeatureOn('Flag')).toBe(true);await replacement;SDK.recordUsage('New');await SDK.flushTelemetry();
    expect(bodies()).toEqual([{k:'identity-app',e:'Production',u:'bob',f:{New:{enabled:[0,1]}}}]);
  } finally {SDK.setLocalGates([])}
});

test('mapper context replacement also invalidates the evaluation after-hook continuation', async () => {
  await init({identity:'alice'});
  SDK.registerContext('AfterSwitch',()=>{SDK.identity='bob';return {kind:'AfterSwitch',key:'entity',attributes:{}}});
  SDK.addHook({getMetadata:()=>({name:'after-mapper-switch'}),afterEvaluation:()=>{SDK.recordUsage('StaleAfter')}});
  try {
    expect(SDK.isFeatureOn('Flag',{},'AfterSwitch')).toBe(true);await settled();await SDK.flushTelemetry();
    expect(bodies()).toEqual([{k:'identity-app',e:'Production',u:'alice',f:{Flag:{enabled:[1]}}}]);
  } finally {SDK.removeHook('after-mapper-switch')}
});

test.each([false, true])('builds a minted endpoint pathname and scrubs every configured targeting field (variants %s)', async enableVariants => {
  global.fetch = jest.fn(async (url, options) => {
    requests.push({ url: new URL(String(url)), init: options });
    return response(tokenDefinitions(enableVariants, true));
  });
  await init({ baseURI: 'https://definitions.invalid/base/?u=old&u=older&userId=private&g=a&g=b&claim.plan=paid&claim.team=secret&keep=one&keep=two', instanceId: ' token ', identity: 'alice', groups: ['staff'], claims: { role: 'admin' }, enableVariants, enableTelemetry: false });
  const url = requests[0].url;
  expect(url.pathname).toBe(`/base/${enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed'}/identity-app/Production`);
  expect(Array.from(url.searchParams.entries())).toEqual([['keep', 'one'], ['keep', 'two'], ['i', 'token']]);
  expect(SDK.isFeatureOn('Flag')).toBe(true);
  if (enableVariants) expect(SDK.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 'A' });
});

test.each([false, true])('preserves configured unrelated queries and ordinary targeting with a blank token (variants %s)', async enableVariants => {
  await init({ baseURI: 'https://definitions.invalid/base/?keep=one&keep=two', instanceId: ' ', identity: 'alice', groups: ['staff'], claims: { role: 'admin' }, enableVariants, enableTelemetry: false });
  const url = requests[0].url;
  expect(url.pathname).toBe(`/base/${enableVariants ? 'evaluated-variants-signed' : 'evaluated-signed'}/identity-app/Production`);
  expect(url.searchParams.getAll('keep')).toEqual(['one', 'two']);
  expect(url.searchParams.get(enableVariants ? 'userId' : 'u')).toBe('alice');
  expect(url.searchParams.getAll('g')).toEqual(['staff']);
  expect(url.searchParams.get('claim.role')).toBe('admin');
  expect(url.searchParams.has('i')).toBe(false);
});

test.each([false, true].flatMap(enableVariants => [undefined, ' '].map(instanceId => ({ enableVariants, instanceId }))))('ignores configured retired i at initialization (variants $enableVariants, token $instanceId)', async ({ enableVariants, instanceId }) => {
  await init({ baseURI: 'https://definitions.invalid/base?i=retired&i=older&keep=one&keep=two', instanceId, identity: 'alice', groups: ['staff'], claims: { role: 'admin' }, enableVariants });
  const query = definitions()[0].url.searchParams;
  expect(query.has('i')).toBe(false);
  expect(query.get(enableVariants ? 'userId' : 'u')).toBe('alice');
  expect(query.getAll('keep')).toEqual(['one', 'two']);
  SDK.recordUsage('Initial'); await SDK.flushTelemetry();
  expect(bodies()[0].u).toBe('alice'); expect(bodies()[0].i).toBeUndefined();
});

test.each([false, true])('keeps active token authority through partial context changes, rotation and explicit clearing (variants %s)', async enableVariants => {
  const transport = global.fetch;
  global.fetch = jest.fn(async (input, options) => {
    if (String(input).includes('/api/frontend/telemetry')) return transport(input, options);
    requests.push({ url: new URL(String(input)), init: options });
    return response(tokenDefinitions(enableVariants, true));
  });
  await init({ baseURI: 'https://definitions.invalid/base?i=retired&u=legacy&userId=legacy&g=old&claim.old=kept&keep=one&keep=two', instanceId: 'current', identity: 'alice', enableVariants });
  SDK.recordUsage('Current');
  await SDK.setContext({ identity: 'bob', groups: ['team'] });
  expect(definitions().at(-1)!.url.searchParams.get('i')).toBe('current');
  SDK.instanceId = 'next'; await SDK.refresh(); SDK.recordUsage('Next');
  SDK.instanceId = ''; await SDK.refresh(); SDK.recordUsage('Cleared');
  expect(definitions().map(r => r.url.searchParams.get('i'))).toEqual(['current', 'current', 'next', null]);
  const query = definitions().at(-1)!.url.searchParams;
  expect(query.get(enableVariants ? 'userId' : 'u')).toBe('bob');
  expect(query.getAll('keep')).toEqual(['one', 'two']);
  expect(query.get('claim.old')).toBe('kept');
  expect(SDK.isFeatureOn('Flag')).toBe(true);
  if (enableVariants) expect(SDK.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 'A' });
  await SDK.flushTelemetry();
  expect(bodies().filter(body => body.f.Current || body.f.Next || body.f.Cleared).map(body => [body.i, body.u])).toEqual([['current', undefined], ['next', undefined], [undefined, 'bob']]);
});
