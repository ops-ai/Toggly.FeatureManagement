import { describe, it, expect } from 'vitest';
import { createTogglyClient } from '@ops-ai/toggly-node-core';
import { createTogglyHandle, loadToggly, requireFeature } from '../src/server.js';

const event = (identity = 'alice') => ({ locals: {}, request: new Request('http://localhost/', {headers:{'user-agent':'Chrome','accept-language':'en-US','cf-ipcountry':'US'}}), url:new URL('http://localhost/'), identity }) as any;
describe('request scope', () => {
 it('isolates concurrent requests, copies context once, and gates actions', async () => {
  const client = createTogglyClient({featureDefaults:{fallback:true},enableStreaming:false,enableUsageTracking:false,enableMetrics:false});
  await client.init();
  client.state.definitions.set('beta',{featureKey:'beta',filters:[{name:'Targeting',parameters:{'Audience.Users:0':'alice'}}]});
  let contextCalls=0;
  const handle=createTogglyHandle({client,context:e=>{contextCalls++;return {identity:(e as any).identity};},frontend:{expose:['fallback'],featureDefaults:{fallback:true,secret:true}}});
  const results=await Promise.all(['alice','bob'].map(async identity=>handle({event:event(identity),resolve:async e=>{
   const snap=await loadToggly(e);
   const enabled=await e.locals.toggly.isEnabled('beta');
   return new Response(JSON.stringify({enabled,snap}));
  }} as any).then(async r=>r.json())));
  expect(results.map(r=>r.enabled)).toEqual([true,false]);
  expect(results[0].snap.definitions).toEqual({fallback:true});
  expect(contextCalls).toBe(2);
  const e=event();
  await handle({event:e,resolve:async()=>new Response()} as any);
  await expect(requireFeature(e,'absent')).rejects.toMatchObject({status:404});
  await expect(requireFeature(e,'fallback')).resolves.toBeUndefined();
  await client.close();
 });
 it('requires hooks before helpers',async()=>{expect(()=>loadToggly(event())).toThrow('hooks.server');});
});

import { vi, afterEach } from 'vitest';
import { envelope, jwk } from './signing.js';
afterEach(()=>vi.unstubAllGlobals());
it('verifies frontend snapshot once, allowlists keys, preserves entity rules and keeps private context private',async()=>{
 const client=createTogglyClient({featureDefaults:{on:true}}); await client.init();
 const entity={requirement:'all',rules:[{property:'Vip',op:'eq',value:'true',type:'boolean'}]};
 const fetcher=vi.fn(async(input:any)=>String(input).endsWith('/.well-known/jwks')?new Response(JSON.stringify({keys:[jwk]})):new Response(envelope({on:true,Order:entity,private:true})));
 vi.stubGlobal('fetch',fetcher);
 const supplied={identity:'alice',groups:['team'],claims:{secret:'private'},request:{country:'GB'}};
 const h=createTogglyHandle({client,context:()=>supplied,clientContext:(_e,c)=>({identity:c.identity,groups:c.groups}),frontend:{appKey:'frontend',expose:['on','Order'],allowedKeyIds:[jwk.kid],maxSignatureAgeSeconds:60}});
 const e=event();
 await h({event:e,resolve:async()=>new Response()} as any);
 supplied.identity='changed';supplied.groups.push('later');
 const [a,b]=await Promise.all([loadToggly(e),loadToggly(e)]);
 expect(a.definitions).toEqual({on:true,Order:entity});
 expect(a.context).toEqual({identity:'alice',groups:['team']});
 a.definitions.on=false;expect(b.definitions.on).toBe(true);
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('u')).toBe('alice');
 expect((fetcher.mock.calls[0] as any)[1]?.headers).toEqual({'User-Agent':'Chrome','Accept-Language':'en-US','cf-ipcountry':'GB'});
 await client.close();
});
it.each(['unsigned','expired','key','network','status','invalid'])('fails closed to explicit exposed defaults: %s',async(mode)=>{
 const onError=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
  if(mode==='network') throw Error('offline');
  if(String(input).endsWith('/.well-known/jwks')) return new Response(JSON.stringify({keys:[jwk]}));
  if(mode==='status')return new Response('',{status:500});
  if(mode==='unsigned')return new Response('{"bad":true}');
  if(mode==='invalid')return new Response('broken');
  return new Response(envelope({bad:true},mode==='expired'?1:undefined));
 }));
 const client=createTogglyClient();await client.init();
 const handle=createTogglyHandle({client,frontend:{appKey:'frontend',baseURI:'https://example.test',environment:'Test',timeout:20,expose:['fallback'],featureDefaults:{fallback:true,private:true},onError,allowedKeyIds:mode==='key'?['wrong']:undefined,maxSignatureAgeSeconds:60}});
 const e=event();await handle({event:e,resolve:async()=>new Response()} as any);
 expect((await loadToggly(e)).definitions).toEqual({fallback:true});expect(onError).toHaveBeenCalledOnce();await client.close();
});
it('binds entities and all/any/negate to the same server context',async()=>{
 const client=createTogglyClient({featureDefaults:{on:true,off:false}});await client.init();
 client.state.definitions.set('Order',{featureKey:'Order',contextKind:'Order',filters:[{name:'ContextProperty',parameters:{Property:'Vip',Operator:'eq',Value:'true'}}]});
 const e=event();await createTogglyHandle({client,frontend:{expose:[]}})({event:e,resolve:async()=>new Response()} as any);
 expect(await e.locals.toggly.gate(['on','off'],{requirement:'any'})).toBe(true);
 expect(await e.locals.toggly.gate(['off'],{negate:true})).toBe(true);
 expect(await e.locals.toggly.isEnabled('Order',{entity:{kind:'Order',key:'1',attributes:{Vip:true}}})).toBe(true);
 expect(await e.locals.toggly.isEnabled('Order')).toBe(false);await client.close();
});
it('captures absent headers, supports array guards, handles 304 and errors without callbacks',async()=>{
 const client=createTogglyClient({featureDefaults:{on:true}});await client.init();
 for(const status of [304,503]){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status})));
  const e=event();e.request=new Request('http://localhost/');
  await createTogglyHandle({client,frontend:{appKey:'frontend',expose:['on'],featureDefaults:{on:true}}})({event:e,resolve:async()=>new Response()} as any);
  expect((await loadToggly(e)).definitions.on).toBe(true);await requireFeature(e,['on']);
 }await client.close();
});
it.each(['throw', 'reject'])('preserves exposed server defaults when the error observer fails: %s', async (mode) => {
 const client = createTogglyClient();
 await client.init();
 vi.stubGlobal('fetch', vi.fn(async () => { throw Error('offline'); }));
 const onError = vi.fn(() => {
  if (mode === 'throw') throw Error('observer failed');
  return Promise.reject(Error('observer rejected'));
 });
 const e = event();
 await createTogglyHandle({ client, frontend: {
  appKey: 'frontend', expose: ['fallback'], featureDefaults: { fallback: true, private: true }, onError,
 } })({ event: e, resolve: async () => new Response() } as any);
 try {
  await expect(loadToggly(e)).resolves.toMatchObject({ definitions: { fallback: true } });
  expect(onError).toHaveBeenCalledOnce();
 } finally { await client.close(); }
});
