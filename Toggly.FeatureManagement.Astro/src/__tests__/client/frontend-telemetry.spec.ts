import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as store from '../../client/store.js';
const telemetry=store as typeof store & {recordUsage:(key:string,variant?:string)=>void;recordView:(key:string,variant?:string)=>void;incrementCounter:(key:string,value?:number)=>void;setGauge:(key:string,value:number)=>void;flushTelemetry:()=>Promise<void>;destroyTogglyClient:()=>void};
const config={appKey:'one',environment:'Test',baseURI:'https://definitions.test',metricsBaseUrl:'https://collector.test/base',featureFlagsRefreshInterval:0,enableLiveUpdates:false};
let bodies:any[]=[];
let definitions:unknown={On:true,Off:false};
const response=(value:unknown)=>({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify(value)});
beforeEach(()=>{bodies=[];definitions={On:true,Off:false};vi.stubGlobal('CompressionStream',undefined);vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(url.includes('/api/frontend/telemetry')){bodies.push({body:JSON.parse(init!.body as string),init,url});return {status:202};}return response(definitions);}));});
afterEach(async()=>{store.__resetClient();await Promise.resolve();vi.unstubAllGlobals();vi.useRealTimers();});
const flush=async()=>telemetry.flushTelemetry?.();

it('counts direct effective leaves once, preserves short circuit and excludes identity',async()=>{
 await store.initTogglyClient({...config,identity:'private',groups:['private'],claims:{role:'private'}});
 expect(store.$flag('On').get()).toBe(true);expect(store.$gate(['Off','Skipped'],'all',true).get()).toBe(true);
 expect(store.$gate(['On','Skipped'],'any').get()).toBe(true);
 telemetry.recordUsage?.('On');telemetry.recordView?.('On','control');telemetry.incrementCounter?.('orders',2);telemetry.setGauge?.('cart',3);
 await flush();expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{On:{enabled:[2,1],control:[0,0,1]},Off:{disabled:[1]}},m:{orders:2,cart:3}}]);
 expect(bodies[0].url).toBe('https://collector.test/base/api/frontend/telemetry');expect(bodies[0].init.credentials).toBe('omit');
});

it('variant APIs count the assigned effective variant once and denied variants as disabled',async()=>{
 definitions={defs:{Experiment:{enabled:true,variant:'control',configurationValue:{size:2}},Denied:{enabled:false,variant:'other'}}};
 await store.initTogglyClient({...config,enableVariants:true});
 expect(store.getVariantValue('Experiment')).toEqual({size:2});expect(store.$variant('Experiment').get()?.name).toBe('control');
 expect(store.getVariant('Denied')).toBeNull();
 store.setLocalGates([{id:'deny',flagKeys:['Experiment'],isEnabled:()=>false}]);
 expect(store.getVariant('Experiment')).toBeNull();
 await flush();expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{Experiment:{control:[2],disabled:[1]},Denied:{disabled:[1]}}}]);
});

it('internal refresh is silent without consumers, local/entity checks report effective outcomes',async()=>{
 definitions={On:true,Entity:{requirement:'all',rules:[{property:'Tier',op:'eq',value:'pro',type:'string'}]}};
 await store.initTogglyClient(config);await store.refreshFlags();await flush();expect(bodies).toEqual([]);
 store.setLocalGates([{id:'deny',flagKeys:['On'],isEnabled:()=>false}]);
 expect(store.$flag('On').get()).toBe(false);expect(store.$flag('Entity').get()).toBe(false);
 expect(store.$flag('Entity',false,{kind:'Account',key:'account-1',attributes:{Tier:'pro'}}).get()).toBe(true);
 await flush();expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{On:{disabled:[1]},Entity:{disabled:[1],enabled:[1]}}}]);
});

it.each([{enableTelemetry:false},{appKey:undefined},{enableUsageTracking:false,enableMetrics:false}])('remains silent with %j',async overrides=>{
 await store.initTogglyClient({...config,...overrides});store.$flag('On').get();telemetry.recordUsage?.('On');telemetry.incrementCounter?.('orders');await flush();expect(bodies).toEqual([]);
});

it('replaces app owner without applying retained old flags or delayed initialization',async()=>{
 let release!:(value:unknown)=>void;
 (fetch as any).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const old=store.initTogglyClient(config);
 definitions={On:false};await store.initTogglyClient({...config,appKey:'two',environment:'New'});
 release(response({On:true}));await old;
 expect(store.$flag('On').get()).toBe(false);await flush();
 expect(bodies.map(x=>x.body)).toEqual([{k:'two',e:'New',f:{On:{disabled:[1]}}}]);
});

it('destruction flushes once and delayed completion cannot restore timers or sockets',async()=>{
 vi.useFakeTimers();let release!:(value:unknown)=>void;
 (fetch as any).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=store.initTogglyClient({...config,featureFlagsRefreshInterval:30000});
 telemetry.destroyTogglyClient?.();release(response({On:true}));await pending;
 expect(store.$isReady.get()).toBe(false);expect(vi.getTimerCount()).toBe(0);
});

it('memoized projections stay silent while subscribed dependency reevaluations count',async()=>{
 await store.initTogglyClient(config);const atom=store.$flag('On');
 expect(atom.get()).toBe(true);expect(atom.get()).toBe(true);await flush();expect(bodies[0].body.f.On.enabled).toEqual([1]);bodies=[];
 const stop=atom.subscribe(()=>{});await flush();expect(bodies).toEqual([]);
 await store.refreshFlags();await flush();expect(bodies[0].body.f.On.enabled).toEqual([1]);bodies=[];
 stop();await store.refreshFlags();await flush();expect(bodies).toEqual([]);
});

it('identity refresh preserves explicit events and replacement final-flushes original labels',async()=>{
 await store.initTogglyClient(config);telemetry.recordUsage('Queued');store.setIdentity('private-user');
 await vi.waitFor(()=>expect((fetch as any).mock.calls.some(([url]:[string])=>url.includes('private-user'))).toBe(true));
 await flush();expect(bodies[0].body).toEqual({k:'one',e:'Test',f:{Queued:{enabled:[0,1]}}});bodies=[];
 telemetry.recordView('Old');await store.initTogglyClient({...config,appKey:'two',environment:'New'});await Promise.resolve();
 await vi.waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0].body).toEqual({k:'one',e:'Test',f:{Old:{enabled:[0,0,1]}}});
 telemetry.recordUsage('New');await flush();expect(bodies[1].body).toEqual({k:'two',e:'New',f:{New:{enabled:[0,1]}}});
});

it('changing telemetry ownership options replaces the reporter even for the same app',async()=>{
 await store.initTogglyClient(config);telemetry.recordUsage('Accepted');
 await store.initTogglyClient({...config,enableTelemetry:false});
 await vi.waitFor(()=>expect(bodies).toHaveLength(1));
 expect(bodies[0].body.f.Accepted.enabled).toEqual([0,1]);
 telemetry.recordUsage('Suppressed');await flush();expect(bodies).toHaveLength(1);
});
it('SSR initialization and explicit browser methods create no resources',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',undefined);vi.stubGlobal('document',undefined);
 await store.initTogglyClient(config);telemetry.recordUsage('On');telemetry.incrementCounter('orders');await flush();
 expect(fetch).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
