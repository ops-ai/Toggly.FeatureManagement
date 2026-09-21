import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import * as store from '../../client/store.js';
import {registerContext} from '@ops-ai/toggly-hooks-types';
import type {TogglyConfig} from '../../types/index.js';
const config = {appKey:'app', environment:'Test', baseURI:'https://definitions.test', metricsBaseUrl:'https://metrics.test', featureFlagsRefreshInterval:0, enableLiveUpdates:false};
const response = (body:unknown, revision='one', status=200) => ({ok:status===200,status,headers:new Headers({'ETag':revision}),text:async()=>JSON.stringify(body)});
let bodies:any[], requests:{url:URL,init:RequestInit}[], defs:unknown;
beforeEach(() => {
 bodies=[]; requests=[]; defs={On:true}; localStorage.clear();
 vi.stubGlobal('CompressionStream', undefined);
 vi.stubGlobal('fetch',vi.fn(async (url:string,init:RequestInit) => {
  if(url.includes('/api/frontend/telemetry')) {bodies.push(JSON.parse(init.body as string));return {status:202};}
  requests.push({url:new URL(url),init});return response(defs);
 }));
});
afterEach(async()=>{store.destroyTogglyClient();await Promise.resolve();vi.unstubAllGlobals();});
const init = (context:Record<string,unknown>={}) => store.initTogglyClient({...config,...context} as TogglyConfig);
const flush = ()=>store.flushTelemetry();

it('prefers host minted identity and suppresses targeting, retaining each accepted queue context',async()=>{
 await init({instanceId:'token-a',identity:'alice',groups:['g'],claims:{role:'admin'}});
 expect([...requests[0].url.searchParams.entries()]).toEqual([['i','token-a']]);
 store.recordUsage('A'); await init({instanceId:'token-b',identity:'bob'});store.recordView('B');
 await init({identity:'carol',groups:['team'],claims:{role:'reader'}});store.incrementCounter('C');
 await init();store.setGauge('D',2);await flush();
 expect(bodies).toEqual([{k:'app',e:'Test',i:'token-a',f:{A:{enabled:[0,1]}}},{k:'app',e:'Test',i:'token-b',f:{B:{enabled:[0,0,1]}}},{k:'app',e:'Test',u:'carol',m:{C:1}},{k:'app',e:'Test',m:{D:2}}]);
 expect(requests[2].url.searchParams.get('u')).toBe('carol');expect(requests[2].url.searchParams.get('g')).toBe('team');
});
it.each([false,true])('pairs only active memory body/revision and never persists orphan mode=%s',async enableVariants=>{
 localStorage.setItem('toggly:revision:app:Test','legacy');
 defs=enableVariants?{defs:{On:{enabled:true,variant:'blue'}}}:{On:true};
 await init({enableVariants,instanceId:'A'});
 expect(requests[0].init.headers).not.toHaveProperty('If-None-Match');expect(localStorage.length).toBe(0);
 (fetch as any).mockImplementationOnce(async(url:string,init:RequestInit)=>{requests.push({url:new URL(url),init});return response(null,'one',304);});
 await store.refreshFlags();expect(requests[1].init.headers).toHaveProperty('If-None-Match','one');
 expect(store.$flag('On').get()).toBe(true);if(enableVariants)expect(store.getVariant('On')?.name).toBe('blue');
 await init({enableVariants,instanceId:'B'});await init({enableVariants,instanceId:'A'});
 expect(requests.slice(2).every(r=>!(r.init.headers as any)['If-None-Match'])).toBe(true);
 store.destroyTogglyClient();await init({enableVariants,instanceId:'A'});expect(requests.at(-1)!.init.headers).not.toHaveProperty('If-None-Match');
});
it('mode changes cannot reuse the other mode body or validator',async()=>{
 defs={defs:{On:{enabled:true,variant:'blue'}}};await init({enableVariants:true});
 defs={On:false};await init({enableVariants:false});expect(store.$flag('On').get()).toBe(false);
 defs={defs:{On:{enabled:true,variant:'green'}}};await init({enableVariants:true});expect(store.getVariant('On')?.name).toBe('green');
 expect(requests.every(r=>!(r.init.headers as any)['If-None-Match'])).toBe(true);
});
it('never admits a validator before its body validates',async()=>{
 await init();(fetch as any).mockImplementationOnce(async()=>response('bad','bad'));await store.refreshFlags();
 await store.refreshFlags();expect(requests.at(-1)!.init.headers).toHaveProperty('If-None-Match','one');
});
it('retains captured flags, assigned variant and Alice before reentrant gates change identity',async()=>{
 defs={defs:{On:{enabled:true,variant:'blue'}}};await init({enableVariants:true,identity:'alice'});
 let changed=false;store.setLocalGates([{id:'switch',flagKeys:['On'],isEnabled:()=>{if(!changed){changed=true;store.setIdentity('bob');}return true;}}]);
 expect(store.getVariant('On')?.name).toBe('blue');await flush();
 expect(bodies).toEqual([{k:'app',e:'Test',u:'alice',f:{On:{blue:[1]}}}]);
});
it('captures owner before entity mappers run and short circuits only evaluated leaves',async()=>{
 await init({identity:'alice'});let changed=false;registerContext('ReentrantAstro',()=>{if(!changed){changed=true;store.setIdentity('bob');}return {kind:'Account',key:'one'};});
 expect(store.$gate(['On','Skipped'],'any',false,{},'ReentrantAstro').get()).toBe(true);await flush();
 expect(bodies).toEqual([{k:'app',e:'Test',u:'alice',f:{On:{enabled:[1]}}}]);
});
it('failed new-context fetch never restores retired definitions or targeting',async()=>{
 await init({identity:'alice'});(fetch as any).mockRejectedValueOnce(new Error('offline'));await init({identity:'bob'});
 expect(store.$flag('On').get()).toBe(false);store.recordUsage('Current');await flush();expect(bodies.at(-1).u).toBe('bob');
 await store.refreshFlags();expect(requests.at(-1)!.url.searchParams.get('u')).toBe('bob');
});
it('stale context completion cannot publish or replace a newer validator',async()=>{
 let release!:(v:unknown)=>void;(fetch as any).mockImplementationOnce(()=>new Promise(r=>release=r));
 const old=init({instanceId:'A'});defs={On:false};await init({instanceId:'B'});release(response({On:true},'old'));await old;
 expect(store.$flag('On').get()).toBe(false);await store.refreshFlags();expect(requests.at(-1)!.init.headers).toHaveProperty('If-None-Match','one');
});
it('transport replacement discards queued old events; final disposal still flushes current events',async()=>{
 await init({identity:'old'});store.recordUsage('Discard');await init({identity:'new',metricsBaseUrl:'https://new.test'});
 expect(bodies).toEqual([]);store.recordUsage('Final');store.destroyTogglyClient();await vi.waitFor(()=>expect(bodies).toHaveLength(1));
 expect(bodies[0]).toEqual({k:'app',e:'Test',u:'new',f:{Final:{enabled:[0,1]}}});
});
it('a pending afterRefresh hook cannot hide subsequent public atom updates or count refresh itself',async()=>{
 let release!:()=>void;let hold=false;const seen:boolean[]=[];
 await init({identity:'alice',hooks:[{getMetadata:()=>({name:'hold'}),afterRefresh:()=>hold?new Promise<void>(r=>release=r):undefined}]});
 const stop=store.$flag('On').subscribe(value=>seen.push(value));await flush();bodies=[];hold=true;
 const pending=store.refreshFlags();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const releaseFirst=release;
 defs={On:false};const current=store.refreshFlags();await vi.waitFor(()=>expect(seen.at(-1)).toBe(false));release();await current;releaseFirst();await pending;
 await flush();expect(bodies).toEqual([{k:'app',e:'Test',u:'alice',f:{On:{enabled:[1],disabled:[1]}}}]);stop();
});

it.each([false,true])('rejects malformed or other-mode bodies without admitting their revision mode=%s',async enableVariants=>{
 defs=enableVariants?{defs:{On:{enabled:true,variant:'blue'}}}:{On:true};await init({enableVariants});
 for(const bad of [null,[],42,enableVariants?{On:true}:{On:{enabled:false,variant:'wrong'}}]) {
  (fetch as any).mockImplementationOnce(async()=>response(bad,'bad'));await store.refreshFlags();
  expect(store.$flag('On').get()).toBe(true);
  (fetch as any).mockImplementationOnce(async(url:string,init:RequestInit)=>{requests.push({url:new URL(url),init});return response(null,'one',304);});
  await store.refreshFlags();expect(requests.at(-1)!.init.headers).toHaveProperty('If-None-Match','one');
 }
});
it('copies targeting input and storage denial stays silent and retains memory variants',async()=>{
 const denied=vi.spyOn(globalThis,'localStorage','get').mockImplementation(()=>{throw Error('denied');});
 const groups=['original'],claims={role:'original'};defs={defs:{On:{enabled:true,variant:'blue'}}};
 try {await init({enableVariants:true,identity:'alice',groups,claims});groups[0]='mutated';claims.role='mutated';await store.refreshFlags();
  expect(requests.at(-1)!.url.searchParams.get('g')).toBe('original');expect(requests.at(-1)!.url.searchParams.get('claim.role')).toBe('original');
  expect(store.getVariant('On')?.name).toBe('blue');await flush();expect(bodies[0].u).toBe('alice');
 } finally {denied.mockRestore();}
});
it('clearIdentity and repeated same context refresh retain explicit signatures and token precedence',async()=>{
 await init({identity:'alice',instanceId:'token'});const returned=store.clearIdentity();expect(returned).toBeUndefined();
 await vi.waitFor(()=>expect(requests).toHaveLength(2));expect(requests[1].url.searchParams.get('i')).toBe('token');
 store.recordUsage('Token');await init({identity:'bob'});store.clearIdentity();await vi.waitFor(()=>expect(requests).toHaveLength(4));
 store.recordUsage('Anonymous');await flush();expect(bodies.map(body=>({i:body.i,u:body.u}))).toEqual([{i:'token',u:undefined},{i:undefined,u:undefined}]);
});
it('preserves failed-send queue attribution across the next context and retries',async()=>{
 vi.useFakeTimers();
 try {
  await init({identity:'alice'});store.recordUsage('A');
  (fetch as any).mockImplementationOnce(async(_url:string,request:RequestInit)=>{bodies.push(JSON.parse(request.body as string));return {status:503};});
  const pending=flush();await vi.advanceTimersByTimeAsync(0);
  await init({identity:'bob'});store.recordUsage('B');
  await vi.advanceTimersByTimeAsync(30000);await pending;await flush();
  expect(bodies.map(body=>body.u)).toEqual(['alice','alice','bob']);
 } finally {vi.useRealTimers();}
});
it('context rotations retain one global admission budget without persisted validators',async()=>{
 await init({identity:'initial'});for(let index=0;index<2200;index++){await init({identity:`user-${index}`});store.recordUsage('One');}
 await flush();expect(bodies).toHaveLength(2000);expect(bodies[0].u).toBe('user-0');expect(bodies.at(-1).u).toBe('user-1999');
 expect(bodies.reduce((bytes,body)=>bytes+JSON.stringify(body).length,0)).toBeLessThanOrEqual(256*1024);expect(localStorage.length).toBe(0);
},15000);
it('subscriber-triggered context replacement cannot republish retired variants',async()=>{
 defs={defs:{On:{enabled:true,variant:'blue'}}};let switched=false;
 const stop=store.$flags.listen(flags=>{if(flags.On===true&&!switched){switched=true;defs={defs:{On:{enabled:false,variant:'red'}}};void init({enableVariants:true,identity:'bob'});}});
 await init({enableVariants:true,identity:'alice'});await vi.waitFor(()=>expect(store.$flags.get().On).toBe(false));
 expect(store.$variants.get().On.variant).toBe('red');expect(store.getVariant('On')).toBeNull();stop();
});

it('an unsolicited 304 cannot promote fallback defaults to a validated body',async()=>{
 (fetch as any).mockRejectedValueOnce(new Error('cold offline'));await init({flagDefaults:{On:true}});
 (fetch as any).mockImplementationOnce(async()=>response(null,'orphan',304));await store.refreshFlags();
 expect(store.$error.get()?.message).toContain('no cached flags');await store.refreshFlags();
 expect(requests.at(-1)!.init.headers).not.toHaveProperty('If-None-Match');
});

it.each(['flag','gate'])('snapshots selected flag values before entity mappers mutate the public atom: %s',async kind=>{
 await init({identity:'alice'});let mutated=false;registerContext(`SnapshotAstro-${kind}`,()=>{if(!mutated){mutated=true;store.$flags.get().On=false;}return {kind:'Account',key:'one'};});
 const atom=kind==='flag'?store.$flag('On',false,{},`SnapshotAstro-${kind}`):store.$gate(['On'],'all',false,{},`SnapshotAstro-${kind}`);
 expect(atom.get()).toBe(true);await flush();expect(bodies[0].f.On.enabled).toEqual([1]);
});

it.each(['flag','gate'])('snapshots nested entity rules before the mapper for %s',async kind=>{
 defs={On:{requirement:'all',rules:[{property:'role',op:'eq',value:'admin'}]}};
 await init({identity:'alice'});
 registerContext('nested-mutation',()=>{
  const definition=store.$flags.get().On;
  if(typeof definition==='object')definition.rules[0].value='retired';
  return {kind:'Account',key:'1',attributes:{role:'admin'}};
 });
 const selected=kind==='flag'?store.$flag('On',false,{},'nested-mutation'):store.$gate(['On'],'all',false,{},'nested-mutation');
 expect(selected.get()).toBe(true);await flush();
 expect(bodies).toEqual([{k:'app',e:'Test',u:'alice',f:{On:{enabled:[1]}}}]);
});
it('snapshots every selected nested gate before an earlier local gate mutates later rules',async()=>{
 defs={First:true,Later:{requirement:'all',rules:[{property:'role',op:'eq',value:'admin'}]}};
 await init({identity:'alice',localGates:[{id:'first',flagKeys:['First'],isEnabled:()=>{
  const definition=store.$flags.get().Later;
  if(typeof definition==='object'){definition.rules[0].value='retired';definition.rules.push({property:'missing',op:'eq',value:'no'});}
  return true;
 }}]});
 expect(store.$gate(['First','Later'],'all',false,{kind:'Account',key:'1',attributes:{role:'admin'}}).get()).toBe(true);
 await flush();expect(bodies[0].f).toEqual({First:{enabled:[1]},Later:{enabled:[1]}});
});
it('stops a superseded refresh hook chain before invoking remaining callbacks',async()=>{
 let release:()=>void=()=>{};let started:()=>void=()=>{};let hold=false;
 const entered=new Promise<void>(resolve=>{started=resolve;});const seen:boolean[]=[];
 await init({hooks:[
  {getMetadata:()=>({name:'hold'}),afterRefresh:()=>hold?new Promise<void>(resolve=>{release=resolve;started();}):undefined},
  {getMetadata:()=>({name:'publish'}),afterRefresh:(flags:Record<string,boolean>)=>{seen.push(flags.On);}},
 ]});
 seen.length=0;hold=true;const old=store.refreshFlags();await entered;
 hold=false;defs={On:false};await store.refreshFlags();release();await old;
 expect(store.$flags.get().On).toBe(false);expect(seen).toEqual([false]);expect(bodies).toEqual([]);
});
it('retains selected local callbacks when an earlier gate replaces a later callback',async()=>{
 defs={First:true,Later:true};
 const later={id:'later',flagKeys:['Later'],isEnabled:()=>true};
 const first={id:'first',flagKeys:['First'],isEnabled:()=>{later.isEnabled=()=>false;return true;}};
 await init({localGates:[first,later]});
 expect(store.$gate(['First','Later']).get()).toBe(true);await flush();
 expect(bodies[0].f).toEqual({First:{enabled:[1]},Later:{enabled:[1]}});
});


it.each([false,true])('constructs the definitions pathname and suppresses every minted targeting query mode=%s',async enableVariants=>{
 defs=enableVariants?{defs:{On:{enabled:true,variant:'blue'}}}:{On:true};
 await init({enableVariants,instanceId:' minted ',identity:'alice',groups:['team'],claims:{role:'reader'},
  baseURI:'https://definitions.test/prefix/?u=old&userId=legacy&g=first&g=second&claim.role=admin&claim.role=staff&claim.plan=paid&keep=one&keep=two#fragment'});
 const url=requests[0].url;
 expect(url.pathname).toBe(`/prefix/${enableVariants?'evaluated-variants-signed':'evaluated-signed'}/app/Test`);
 expect(url.searchParams.get('i')).toBe('minted');
 expect([...url.searchParams.keys()].some(key=>['u','userId','g'].includes(key)||key.startsWith('claim.'))).toBe(false);
 expect(url.searchParams.getAll('keep')).toEqual(['one','two']);
 expect(store.$flag('On').get()).toBe(true);
 if(enableVariants) expect(store.getVariant('On')?.name).toBe('blue');
});
it.each([false,true])('preserves no-token targeting and unrelated base query fields mode=%s',async enableVariants=>{
 defs=enableVariants?{defs:{On:{enabled:true,variant:'blue'}}}:{On:true};
 await init({enableVariants,identity:'alice',groups:['team'],claims:{role:'reader'},baseURI:'https://definitions.test/prefix/?keep=one&keep=two'});
 const url=requests[0].url;
 expect(url.pathname).toBe(`/prefix/${enableVariants?'evaluated-variants-signed':'evaluated-signed'}/app/Test`);
 expect(url.searchParams.getAll('keep')).toEqual(['one','two']);
 expect(url.searchParams.get('i')).toBeNull();expect(url.searchParams.get(enableVariants?'userId':'u')).toBe('alice');
 expect(url.searchParams.get('g')).toBe('team');expect(url.searchParams.get('claim.role')).toBe('reader');
});
