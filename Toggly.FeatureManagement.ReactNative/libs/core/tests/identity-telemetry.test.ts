import { TogglyService } from '../src/services/TogglyService';
import { MemoryStorage } from '../src/services/MemoryStorage';
import type { TogglyConfig } from '../src/models/types';
const services: TogglyService[] = [];
const packets: any[] = [];
const requests: {url:URL;init:RequestInit}[] = [];
const response = (flags: unknown, etag = 'one') => ({ok:true,status:200,headers:new Map([['ETag',etag]]),text:async()=>JSON.stringify(flags)});
function client(config: TogglyConfig & {instanceId?:string} = {}) {
  const t=new TogglyService({appKey:'native',environment:'Test',identity:'alice',refreshInterval:0,enableLiveUpdates:false,metricsBaseUrl:'https://collector.test',...config} as TogglyConfig);
  services.push(t);return t;
}
beforeEach(()=>{
  packets.length=0;requests.length=0;
  Object.defineProperty(globalThis,'CompressionStream',{value:undefined,configurable:true});
  (fetch as jest.Mock).mockImplementation(async (url:string,init:RequestInit)=>{
    if(url.includes('/api/frontend/telemetry')){packets.push(JSON.parse(init.body as string));return {status:202}}
    requests.push({url:new URL(url),init});return response({On:new URL(url).searchParams.get('i')!=='B'});
  });
});
afterEach(()=>services.splice(0).forEach(t=>t.dispose()));
it.each([false,true])('keeps reserved key and environment characters in path segments with inert pathname=%s',async inert=>{
  const NativeURL=globalThis.URL;
  class HermesURL extends NativeURL {
    get pathname():string{return super.pathname}
    set pathname(_path:string){/* React Native native URL may ignore assignment. */}
  }
  if(inert) globalThis.URL=HermesURL;
  try {
    (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{
      requests.push({url:new NativeURL(url),init});return response({On:true});
    });
    const t=client({appKey:'sample?token=broken#part',environment:'QA?stage#canary',baseURI:'https://defs.test/base/?keep=one&keep=two',enableTelemetry:false});
    await t.init();
    expect(requests[0].url.pathname).toBe('/base/evaluated-signed/sample%3Ftoken=broken%23part/QA%3Fstage%23canary');
    expect([...requests[0].url.searchParams]).toEqual([['keep','one'],['keep','two'],['u','alice']]);
    expect(requests[0].url.hash).toBe('');
  } finally {globalThis.URL=NativeURL;}
});
it('constructs definitions and JWKS paths when Hermes ignores URL.pathname writes',async()=>{
  const NativeURL=globalThis.URL;
  class HermesURL extends NativeURL {
    get pathname():string{return super.pathname}
    set pathname(_path:string){/* Native React Native URL can ignore assignment. */}
  }
  globalThis.URL=HermesURL;
  try {
    (fetch as jest.Mock).mockImplementation(async(url:string)=>{
      requests.push({url:new NativeURL(url),init:{}});
      return url.includes('/.well-known/jwks')
        ? {ok:true,status:200,json:async()=>({keys:[]})}
        : response({On:true});
    });
    const t=client({baseURI:'https://defs.test/base/?keep=one&keep=two',enableTelemetry:false});
    await t.init();
    expect(requests[0].url.pathname).toBe('/base/evaluated-signed/native/Test');
    expect(requests[0].url.searchParams.getAll('keep')).toEqual(['one','two']);
    await (t as any).getJwks(new AbortController().signal,()=>true);
    expect(requests[1].url.pathname).toBe('/base/.well-known/jwks');
    expect(requests[1].url.searchParams.getAll('keep')).toEqual(['one','two']);
  } finally {globalThis.URL=NativeURL;}
});
it('sends telemetry to the configured path when Hermes ignores pathname writes',async()=>{
  const NativeURL=globalThis.URL;
  class HermesURL extends NativeURL {
    get pathname():string{return super.pathname}
    set pathname(_path:string){/* Match the native URL implementation. */}
  }
  globalThis.URL=HermesURL;
  try {
    const posts:string[]=[];
    (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{
      if(init.method==='POST'){posts.push(url);packets.push(JSON.parse(init.body as string));return {status:202};}
      return response({On:true});
    });
    const t=client({metricsBaseUrl:'https://collector.test/nested/'});
    await t.init();expect(await t.isFeatureOn('On')).toBe(true);await t.flushTelemetry();
    expect(posts).toEqual(['https://collector.test/nested/api/frontend/telemetry']);
    expect(packets).toEqual([{k:'native',e:'Test',u:'alice',f:{On:{enabled:[1]}}}]);
  } finally {globalThis.URL=NativeURL;}
});
it('forwards minted context, scrubs inherited targeting, preserves repeated unrelated values and clears through identity',async()=>{
  const t=client({instanceId:' A ',baseURI:'https://defs.test/root/?u=old&userId=old&g=a&g=b&claim.role=old&i=retired&i=older&keep=one&keep=two',groups:['private'],claims:{role:'private'}});
  await t.init();t.recordUsage('A');
  await t.setContext({instanceId:'B'} as any);t.recordView('B');
  await t.setIdentity('bob');t.recordUsage('Bob');await t.flushTelemetry();
  expect(requests[0].url.pathname).toBe('/root/evaluated-signed/native/Test');
  expect([...requests[0].url.searchParams]).toEqual([['keep','one'],['keep','two'],['i','A']]);
  expect(requests[1].url.searchParams.get('i')).toBe('B');
  expect(requests[2].url.searchParams.has('i')).toBe(false);
  expect(requests[2].url.searchParams.get('u')).toBe('bob');
  expect(packets).toEqual([
    {k:'native',e:'Test',i:'A',f:{A:{enabled:[0,1]}}},
    {k:'native',e:'Test',i:'B',f:{B:{enabled:[0,0,1]}}},
    {k:'native',e:'Test',u:'bob',f:{Bob:{enabled:[0,1]}}},
  ]);
});
it('captures selected nested definitions, local callbacks and attribution before a held hook',async()=>{
  const later={id:'later',flagKeys:['Entity'],isEnabled:()=>true};
  let release!:()=>void;
  const gate={requirement:'all',rules:[{property:'role',op:'eq',value:'admin',type:'string'}]};
  const t=client({instanceId:'A',featureDefaults:{First:true,Entity:gate} as any,localGates:[{id:'first',flagKeys:['First'],isEnabled:()=>{later.isEnabled=()=>false;return true}},later]});
  (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{
    if(url.includes('/api/frontend/telemetry')){packets.push(JSON.parse(init.body as string));return {status:202}}
    return response({First:true,Entity:gate});
  });
  await t.init();t.addHook({getMetadata:()=>({name:'held'}),beforeEvaluation:()=>new Promise<void>(resolve=>{release=resolve})});
  const pending=t.evaluateFeatureGate(['First','Entity'],'all',false,{kind:'User',key:'one',attributes:{role:'admin'}});
  for(let i=0;i<20&&!release;i++) await Promise.resolve();
  (t.currentFeatures!.Entity as any).rules[0].value='retired';
  await t.setContext({instanceId:'B'} as any);release();
  expect(await pending).toBe(true);await t.flushTelemetry();
  expect(packets).toEqual([
    {k:'native',e:'Test',i:'A',f:{First:{enabled:[1]}}},
    {k:'native',e:'Test',i:'A',f:{Entity:{enabled:[1]}}},
  ]);
});
it('keeps late prior-context network data out of the new context and permits its immediate request',async()=>{
  let release!: (value:unknown)=>void;
  (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{
    requests.push({url:new URL(url),init});
    if(new URL(url).searchParams.get('i')==='A') return new Promise(resolve=>{release=resolve});
    return response({On:false},'B');
  });
  const t=client({instanceId:'A',enableTelemetry:false});const initial=t.init();
  for(let i=0;i<30&&!release;i++) await Promise.resolve();
  const changed=t.setContext({instanceId:'B'} as any);
  for(let i=0;i<30&&requests.length<2;i++) await Promise.resolve();
  expect(requests.map(x=>x.url.searchParams.get('i'))).toEqual(['A','B']);
  release(response({On:true},'A'));await Promise.all([initial,changed]);
  expect(t.currentFeatures).toEqual({On:false});expect(t.initialized).toBe(true);
});
it('retains original token cache across ABA and refuses a bodyless live304 disk validator after LRU eviction',async()=>{
  const storage=new MemoryStorage();
  (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{
    const token=new URL(url).searchParams.get('i');requests.push({url:new URL(url),init});
    if(new Headers(init.headers).has('If-None-Match'))return {status:304,ok:false,headers:new Map([['ETag',token]])};
    return response({On:token==='A'},token!);
  });
  const a=client({instanceId:'A',storage,maxCacheKeys:1,enableTelemetry:false});await a.init();
  const b=client({instanceId:'B',storage,maxCacheKeys:1,enableTelemetry:false});await b.init();
  expect((await a.refresh()).flags).toEqual({On:true});
  const revision=await storage.get('@toggly:etag');
  expect(revision===null||JSON.parse(revision).context.includes('B')).toBe(true);
  const reload=client({instanceId:'A',storage,maxCacheKeys:1,enableTelemetry:false});await reload.init();
  expect(new Headers(requests.at(-1)!.init.headers).has('If-None-Match')).toBe(false);
});
it('lets a newer same-context refresh own hooks and publication while an older hook is held',async()=>{
  const t=client({instanceId:'A',enableTelemetry:false});await t.init();
  let release!:()=>void;let entered!:()=>void;const entering=new Promise<void>(resolve=>{entered=resolve});let first=true;const hooks:boolean[]=[];const publications:boolean[]=[];
  t.addHook({getMetadata:()=>({name:'hold'}),afterRefresh:()=>{if(first){first=false;return new Promise<void>(resolve=>{release=resolve;entered()})}}});
  t.addHook({getMetadata:()=>({name:'observe'}),afterRefresh:flags=>{hooks.push(flags.On)}});
  t.on('refreshed',event=>publications.push((event.data as {On:boolean}).On));
  (fetch as jest.Mock).mockResolvedValueOnce(response({On:false},'old')).mockResolvedValueOnce(response({On:true},'new'));
  const old=t.refresh();await entering;
  expect(release).toBeDefined();await t.refresh();release();await old;
  expect(t.currentFeatures).toEqual({On:true});expect(hooks).toEqual([true]);expect(publications).toEqual([true]);
});
it('keeps the latest identity intent when an earlier beforeIdentify hook settles afterward',async()=>{
  const t=client({instanceId:'A',enableTelemetry:false});await t.init();let release!:()=>void;
  t.addHook({getMetadata:()=>({name:'hold'}),beforeIdentify:identity=>identity==='bob'?new Promise<void>(resolve=>{release=resolve}):undefined});
  const changed:string[]=[];t.on('identityChanged',event=>changed.push((event.data as {newIdentity:string}).newIdentity));
  const old=t.setIdentity('bob');await Promise.resolve();await t.setIdentity('carol');release();await old;
  expect(t.currentIdentity).toBe('carol');expect(changed).toEqual(['carol']);
  expect(requests.at(-1)!.url.searchParams.get('u')).toBe('carol');expect(requests.at(-1)!.url.searchParams.has('i')).toBe(false);
});
it('removes a paired global validator when its body is evicted by a response without an etag',async()=>{
  const storage=new MemoryStorage();
  (fetch as jest.Mock).mockImplementation(async(url:string)=>response({On:true},new URL(url).searchParams.get('i')==='A'?'A':''));
  const a=client({storage,maxCacheKeys:1,instanceId:'A',enableTelemetry:false});await a.init();
  expect(await storage.get('@toggly:etag')).not.toBeNull();
  const b=client({storage,maxCacheKeys:1,instanceId:'B',enableTelemetry:false});await b.init();
  expect(await storage.get('@toggly:etag')).toBeNull();expect(b.currentFeatures).toEqual({On:true});
});
it.each([undefined,'','   '])('never revives configured i for an initial absent or blank token %j',async instanceId=>{
  const t=client({instanceId,baseURI:'https://defs.test/base?i=retired&i=older&keep=one&keep=two'});await t.init();
  expect(requests[0].url.searchParams.getAll('i')).toEqual([]);expect(requests[0].url.searchParams.get('u')).toBe('alice');
  expect(requests[0].url.searchParams.getAll('keep')).toEqual(['one','two']);
  expect(await t.isFeatureOn('On')).toBe(true);await t.flushTelemetry();expect(packets).toEqual([{k:'native',e:'Test',u:'alice',f:{On:{enabled:[1]}}}]);
});
it('retires the old validator when a successful replacement body has no etag',async()=>{
  const storage=new MemoryStorage();const t=client({instanceId:'A',storage,enableTelemetry:false});await t.init();
  (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{requests.push({url:new URL(url),init});return response({On:false},'')});
  await t.refresh();expect(t.currentFeatures).toEqual({On:false});expect(await storage.get('@toggly:etag')).toBeNull();
  await t.refresh();expect(new Headers(requests.at(-1)!.init.headers).has('If-None-Match')).toBe(false);
});
it('restores a mixed boolean and entity cache without a validator into the current offline public state',async()=>{
  const storage=new MemoryStorage();const gate={requirement:'all',rules:[{property:'role',op:'eq',value:'admin',type:'string'}]};
  (fetch as jest.Mock).mockResolvedValue(response({On:true,Entity:gate},''));
  const writer=client({instanceId:'A',storage,enableTelemetry:false});await writer.init();writer.dispose();
  const reader=client({instanceId:'B',storage,enableTelemetry:false,featureDefaults:{On:false},networkInfo:{getState:async()=>({isConnected:false,isInternetReachable:false}),subscribe:()=>()=>{}}});
  await reader.init();expect(reader.currentFeatures).toEqual({On:false});
  const restored=await reader.setContext({instanceId:'A'});expect(restored.flags).toEqual({On:true,Entity:gate});expect(reader.currentFeatures).toEqual(restored.flags);
  expect(await reader.isFeatureOn('Entity',{kind:'User',key:'one',attributes:{role:'admin'}})).toBe(true);
  expect(await reader.isFeatureOn('Entity',{kind:'User',key:'one',attributes:{role:'guest'}})).toBe(false);
});
it('keeps the request deadline active while reading a response body',async()=>{
  let signal!:AbortSignal;
  (fetch as jest.Mock).mockImplementation(async(_url:string,init:RequestInit)=>{signal=init.signal!;return {ok:true,status:200,headers:new Map(),text:()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('body aborted')),{once:true}))}});
  const t=client({instanceId:'A',requestTimeout:25,enableTelemetry:false,featureDefaults:{On:false}});
  const result=await t.init();expect(signal.aborted).toBe(true);expect(result.flags).toEqual({On:false});expect(t.currentFeatures).toEqual({On:false});
});
it('uses the same abortable deadline for a JWKS body and scrubs its configured query',async()=>{
  let jwksUrl!:URL;let jwksSignal!:AbortSignal;let definitionsSignal!:AbortSignal;
  (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{
    if(url.includes('/.well-known/jwks')){jwksUrl=new URL(url);jwksSignal=init.signal!;return {ok:true,status:200,json:()=>new Promise((_resolve,reject)=>jwksSignal.addEventListener('abort',()=>reject(new Error('jwks aborted')),{once:true}))}}
    definitionsSignal=init.signal!;return response({defs:{On:true},signature:'signature',timestamp:1,kid:'key'});
  });
  const t=client({instanceId:'A',requestTimeout:50,enableTelemetry:false,verifySignatures:true,featureDefaults:{On:false},baseURI:'https://defs.test/base?i=retired&u=old&userId=old&g=private&claim.role=secret&keep=one&keep=two'});
  const result=await t.init();expect(result.flags).toEqual({On:false});expect(jwksSignal).toBe(definitionsSignal);expect(jwksSignal.aborted).toBe(true);
  expect(jwksUrl.pathname).toBe('/base/.well-known/jwks');expect([...jwksUrl.searchParams]).toEqual([['keep','one'],['keep','two']]);
});
it('keeps Unicode group cache keys stable across permutations without mutating caller input',async()=>{
  const groups=['\uE000','😀','a','a','A'];const original=[...groups];const storage=new MemoryStorage();
  const a=client({groups,storage,enableTelemetry:false});await a.init();a.dispose();
  const b=client({groups:[...groups].reverse(),storage,enableTelemetry:false});await b.init();
  expect(new Headers(requests.at(-1)!.init.headers).get('If-None-Match')).toBe('one');expect(groups).toEqual(original);
  expect(requests[0].url.searchParams.getAll('g')).toEqual(groups);
});
it('stops a superseded context publication before invoking its remaining observers',async()=>{
  const t=client({instanceId:'A',enableTelemetry:false});await t.init();
  let next:Promise<unknown>|undefined;const seen:(string|null)[]=[];
  t.on('effectiveFlagsChanged',()=>{if(t.currentIdentity==='bob'&&!next)next=t.setIdentity('carol')});
  t.on('effectiveFlagsChanged',()=>seen.push(t.currentIdentity));
  await t.setIdentity('bob');await next;
  expect(t.currentIdentity).toBe('carol');expect(seen).not.toContain('bob');expect(seen).toContain('carol');
});

it.each([{kind:'body',signed:false},{kind:'validator',signed:false},{kind:'body',signed:true},{kind:'validator',signed:true}])('repairs a retired asynchronous $kind write across ABA before cold304 restoration (signed=$signed)',async({kind,signed})=>{
 const values=new Map<string,string>();let hold=false;let release!:()=>void;let blocked=false;
 const storage={get:async(key:string)=>values.get(key)??null,delete:async(key:string)=>{values.delete(key)},set:async(key:string,value:string)=>{
   if(hold&&!blocked&&(kind==='body'?key.startsWith('@toggly:featureFlagsCache:'):key==='@toggly:etag')){blocked=true;await new Promise<void>(resolve=>{release=resolve})}values.set(key,value);
 }};
 let phase='old';
 (fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{requests.push({url:new URL(url),init});return phase==='cold'?{status:304,ok:false,headers:new Map()}:response({On:phase!=='old',Off:phase==='old'},phase)});
 const owner=client({storage,instanceId:'A',enableTelemetry:false,featureDefaults:{On:false,Off:true},maxCacheKeys:8,useSignedDefinitions:signed});await owner.init();hold=true;
 const pending=owner.refresh();for(let n=0;n<100&&!release;n++)await new Promise(resolve=>setTimeout(resolve,1));expect(release).toBeDefined();
 phase='new';await owner.setContext({instanceId:'B'});await owner.setContext({instanceId:'A'});expect(owner.currentFeatures).toEqual({On:true,Off:false});
 release();await pending;owner.dispose({flush:false});
 const revision=JSON.parse(values.get('@toggly:etag')!);expect(revision.revision).toBe('new');
 const body=[...values].filter(([key])=>key.startsWith('@toggly:featureFlagsCache:')).map(([,raw])=>JSON.parse(raw)).find(body=>body.identity===revision.context);
 expect(JSON.parse(body.flags)).toEqual({On:true,Off:false});expect(body.writeId).toEqual(revision.writeId);expect(typeof revision.writeId).toBe('string');
 phase='cold';const cold=client({storage,instanceId:'A',enableTelemetry:false,featureDefaults:{On:false,Off:true},maxCacheKeys:8,useSignedDefinitions:signed});await cold.init();
 expect(new Headers(requests.at(-1)!.init.headers).get('If-None-Match')).toBe('new');
 expect(cold.currentFeatures).toEqual({On:true,Off:false});expect(await cold.isFeatureOn('On')).toBe(true);expect(await cold.isFeatureOn('Off')).toBe(false);
});

it.each(['body','validator'] as const)('rejects a mismatched persisted pair after a separate adapter delays its %s write',async(kind)=>{
 const values=new Map<string,string>();let hold=false;let release!:()=>void;let blocked=false;
 const plain={get:async(key:string)=>values.get(key)??null,delete:async(key:string)=>{values.delete(key)},set:async(key:string,value:string)=>{values.set(key,value)}};
 const delayed={...plain,set:async(key:string,value:string)=>{if(hold&&!blocked&&(kind==='body'?key.startsWith('@toggly:featureFlagsCache:'):key==='@toggly:etag')){blocked=true;await new Promise<void>(resolve=>{release=resolve})}values.set(key,value)}};
 let phase='old';(fetch as jest.Mock).mockImplementation(async(url:string,init:RequestInit)=>{requests.push({url:new URL(url),init});return response({On:phase!=='old'},phase)});
 const owner=client({storage:delayed,instanceId:'A',enableTelemetry:false});await owner.init();hold=true;
 const pending=owner.refresh();for(let n=0;n<100&&!release;n++)await new Promise(resolve=>setTimeout(resolve,1));expect(release).toBeDefined();
 owner.dispose({flush:false});phase='new';const replacement=client({storage:plain,instanceId:'A',enableTelemetry:false});await replacement.init();
 release();await pending;replacement.dispose({flush:false});
 const cold=client({storage:plain,instanceId:'A',enableTelemetry:false,featureDefaults:{On:false}});await cold.init();
 expect(new Headers(requests.at(-1)!.init.headers).has('If-None-Match')).toBe(false);expect(await cold.isFeatureOn('On')).toBe(true);
});
it('repairs a retired body even when its storage mutation rejects after overwriting the newer value',async()=>{
 const values=new Map<string,string>();let hold=false;let release!:()=>void;let blocked=false;
 const storage={get:async(key:string)=>values.get(key)??null,delete:async(key:string)=>{values.delete(key)},set:async(key:string,value:string)=>{
  const retired=hold&&!blocked&&key.startsWith('@toggly:featureFlagsCache:');if(retired){blocked=true;await new Promise<void>(resolve=>{release=resolve})}values.set(key,value);if(retired)throw new Error('retired storage failure');
 }};
 let latest=false;(fetch as jest.Mock).mockImplementation(async()=>response({On:latest},latest?'new':'old'));
 const owner=client({storage,instanceId:'A',enableTelemetry:false});await owner.init();hold=true;
 const pending=owner.refresh();for(let n=0;n<100&&!release;n++)await new Promise(resolve=>setTimeout(resolve,1));expect(release).toBeDefined();
 latest=true;await owner.setContext({instanceId:'B'});await owner.setContext({instanceId:'A'});release();await pending;
 const revision=JSON.parse(values.get('@toggly:etag')!);const body=[...values].filter(([key])=>key.startsWith('@toggly:featureFlagsCache:')).map(([,value])=>JSON.parse(value)).find(body=>body.identity===revision.context);
 expect(body.writeId).toBe(revision.writeId);expect(JSON.parse(body.flags)).toEqual({On:true});expect(owner.currentFeatures).toEqual({On:true});
});
