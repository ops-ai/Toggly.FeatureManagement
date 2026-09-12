// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTogglyRequest, serializeSnapshot } from '../src/server';

describe('request-scoped server adapter', () => {
  it('copies per-request targeting and forwards native entity evaluations', async () => {
    const client={isFeatureOn:vi.fn(async (_key,context)=>context.identity==='alice'),evaluateFeatureGate:vi.fn(async (_keys,_requirement,_negate,context)=>context.identity==='alice')};
    const context={identity:'alice',groups:['staff'],claims:{role:'admin'}};
    const a=createTogglyRequest({client:client as any,request:new Request('http://localhost/'),context,frontend:{expose:['public']}});
    const b=createTogglyRequest({client:client as any,request:new Request('http://localhost/'),context:{identity:'bob'},frontend:{expose:[]}});
    context.identity='changed';
    expect(await Promise.all([a.isEnabled('flag'),b.isEnabled('flag')])).toEqual([true,false]);
    await a.requireFeature('flag'); await expect(b.requireFeature(['flag'])).rejects.toMatchObject({status:404});
    expect(client.isFeatureOn.mock.calls[0][1].groups).toEqual(['staff']);
    a.dispose(); await expect(a.isEnabled('flag')).rejects.toThrow('disposed'); b.dispose();
  });
  it('serializes only explicit public defaults/context and escapes inline scripts', async () => {
    const c=createTogglyRequest({client:{} as any,request:new Request('http://localhost/'),context:{identity:'backend-secret'},frontend:{expose:['safe'],flagDefaults:{safe:true,secret:true}},clientContext:{identity:'</script><script>alert(1)</script>'}});
    const snapshot=await c.snapshot();
    expect(snapshot.definitions).toEqual({safe:true});
    const text=serializeSnapshot(snapshot);expect(text).not.toContain('</script>');expect(text).not.toContain('backend-secret');expect(JSON.parse(text)).toEqual(snapshot);
    snapshot.definitions.safe=false; expect((await c.snapshot()).definitions.safe).toBe(true);c.dispose();
  });
});

import { createTogglyClient } from '../src/server';
import { envelope,jwks,startService } from './fixtures/service.mjs';

describe('canonical signed server boundary',()=>{
  it('uses the packed shared evaluator for concurrent principals, claims, groups and entities',async()=>{
    const service=await startService();
    const client=createTogglyClient({appKey:'backend-private-key-sentinel',baseUrl:service.baseURI,verifySignatures:true,identity:'alice',enableFileCache:false,refreshInterval:0,enableStreaming:false,enableUsageTracking:false,enableMetrics:false,registerContextsOnStartup:false});
    try {
      await client.init();
      const a=createTogglyRequest({client,request:new Request('http://app/'),context:{identity:'alice',groups:['staff'],claims:{role:'admin'}},clientContext:{identity:'alice'},frontend:{appKey:'frontend-test-key',baseURI:service.baseURI,expose:['BetaDashboard','ExpressCheckout']}});
      const b=createTogglyRequest({client,request:new Request('http://app/'),frontend:{expose:[]}});
      expect(await Promise.all([a.isEnabled('BetaDashboard'),b.isEnabled('BetaDashboard'),a.isEnabled('GroupTargeting'),b.isEnabled('GroupTargeting'),a.isEnabled('ClaimsTargeting'),b.isEnabled('ClaimsTargeting')])).toEqual([true,false,true,false,true,false]);
      expect(await a.isEnabled('ExpressCheckout',{kind:'Order',key:'1',attributes:{Vip:true}})).toBe(true);
      expect(await a.isEnabled('ExpressCheckout',{kind:'Order',key:'2',attributes:{Vip:false}})).toBe(false);
      expect(await a.evaluate(['BetaDashboard','missing'],{requirement:'any'})).toBe(true);
      expect(await b.evaluate(['BetaDashboard'],{negate:true})).toBe(true);
      const snapshot=await a.snapshot(); expect(snapshot.source).toBe('signed');expect(snapshot.definitions.BetaDashboard).toBe(true);
      expect(JSON.stringify(snapshot)).not.toMatch(/backend-private|backend-only|secret/); a.dispose();b.dispose();
    }finally{await client.close();await service.close();}
  });
  it.each(['der','ieee-p1363'])('verifies canonical %s and projects explicit context/keys',async encoding=>{
    const calls:any[]=[];
    const f=vi.fn(async(url,init)=>{calls.push([url,init]);return new Response(String(url).includes('.well-known')?JSON.stringify(jwks):envelope({visible:true,private:true},encoding));});
    const c=createTogglyRequest({client:{} as any,request:new Request('http://app/',{headers:{'user-agent':'agent','accept-language':'fr'}}),context:{claims:{private:'secret'}},clientContext:{identity:'alice',groups:['staff'],claims:{tier:'pro'}},frontend:{appKey:'front',expose:['visible'],fetch:f}});
    const s=await c.snapshot();expect(s.source).toBe('signed');expect(s.definitions).toEqual({visible:true});
    expect(calls.every(([,init])=>init.cache==='no-store')).toBe(true);expect(calls[0][1].headers['User-Agent']).toBe('agent');expect(String(calls[0][0])).toContain('claim.tier=pro');c.dispose();
  });
  it.each(['tamper','expired','wrong-key','304','invalid-definitions','offline'])('fails closed on %s',async mode=>{
    const error=vi.fn();
    const f=vi.fn(async url=>{
      if(String(url).includes('.well-known'))return new Response(JSON.stringify(jwks));
      if(mode==='offline')throw Error('offline');
      if(mode==='304')return new Response(null,{status:304});
      let body=envelope(mode==='invalid-definitions'?[]:{visible:true},'der',mode==='expired'?1:undefined);
      if(mode==='tamper')body=body.replace('true','false');
      return new Response(body);
    });
    const c=createTogglyRequest({client:{} as any,request:new Request('http://app/'),frontend:{appKey:'front',expose:['visible'],fetch:f,onError:error,maxSignatureAgeSeconds:60,allowedKeyIds:mode==='wrong-key'?['wrong']:undefined,flagDefaults:{visible:false,private:true}}});
    expect(await c.snapshot()).toMatchObject({source:'defaults',definitions:{visible:false}});expect(error).toHaveBeenCalledOnce();c.dispose();
  });
  it('rejects backend-key reuse and disposed in-flight operations',async()=>{
    expect(()=>createTogglyRequest({client:{config:{appKey:'backend'}} as any,request:new Request('http://app/'),frontend:{appKey:'backend',expose:[]}})).toThrow('distinct');
    let resolve:any;
    const c=createTogglyRequest({client:{isFeatureOn:()=>new Promise(r=>resolve=r)} as any,request:new Request('http://app/'),frontend:{expose:[]}});
    const p=c.isEnabled('flag');c.dispose();resolve(true);await expect(p).rejects.toThrow('disposed');
    const controller=new AbortController();controller.abort();
    const aborted=createTogglyRequest({client:{} as any,request:new Request('http://app/',{signal:controller.signal}),frontend:{expose:[]}});await expect(aborted.snapshot()).rejects.toThrow('disposed');
  });
  it('aborts pending frontend reads and applies bounded timeout defaults',async()=>{
    let signal:AbortSignal;
    const f=vi.fn(async(_url,init)=>{signal=init.signal;return new Promise<Response>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)));});
    const options={client:{} as any,request:new Request('http://app/'),frontend:{appKey:'front',expose:['visible'],fetch:f,timeout:10}};
    const timed=createTogglyRequest(options);expect((await timed.snapshot()).source).toBe('defaults');expect(signal!.aborted).toBe(true);timed.dispose();
    const c=createTogglyRequest(options);const pending=c.snapshot();c.dispose();await expect(pending).rejects.toThrow('disposed');
  });
});

describe('failure-path observer and payload isolation',()=>{
 it.each(['throw','reject'])('preserves allowlisted defaults when observer %s',async mode=>{
  let calls=0;const error=()=>{calls++;if(mode==='throw')throw Error('observer failure');return Promise.reject(Error('observer rejection'));};
  const c=createTogglyRequest({client:{} as any,request:new Request('http://app/'),frontend:{appKey:'front',expose:['safe'],flagDefaults:{safe:false,secret:true},fetch:async()=>{throw Error('offline')},onError:error}});
  try{expect(await c.snapshot()).toMatchObject({source:'defaults',definitions:{safe:false}});expect(calls).toBe(1);await new Promise(r=>setTimeout(r,0));}finally{c.dispose();}
 });
 it.each(['visible','unexposed'])('rejects a correctly signed malformed %s gate before projection',async key=>{
  const error=vi.fn();const f=vi.fn(async url=>new Response(String(url).includes('.well-known')?JSON.stringify(jwks):envelope({visible:true,[key]:{requirement:'all',rules:[{property:'Vip'}]}})));
  const c=createTogglyRequest({client:{} as any,request:new Request('http://app/'),frontend:{appKey:'front',expose:['visible'],flagDefaults:{visible:false},fetch:f,onError:error}});
  try{expect(await c.snapshot()).toMatchObject({source:'defaults',definitions:{visible:false}});expect(error).toHaveBeenCalledOnce();}finally{c.dispose();}
 });
});

it('accepts signed complete rules with optional types and case-insensitive operators',async()=>{
 const definitions=Object.fromEntries(['eq','neq','gt','gte','lt','lte','in','contains','EQ'].map((op,i)=>['gate'+i,{requirement:'any',rules:[{property:'',op,value:''},...['datetime','number','boolean','string','string[]'].map(type=>({property:'Vip',op,value:'true',type}))]}]));
 const c=createTogglyRequest({client:{} as any,request:new Request('http://app/'),frontend:{appKey:'front',expose:Object.keys(definitions),fetch:async url=>new Response(String(url).includes('.well-known')?JSON.stringify(jwks):envelope(definitions))}});
 try{expect(await c.snapshot()).toMatchObject({source:'signed',definitions});}finally{c.dispose();}
});

it('uses the canonical shared public-key identifier independently of signature hashing',async()=>{
 const {computeKid}=await import('@ops-ai/toggly-signed-defs');
 expect(jwks.keys[0].kid).toBe(await computeKid(jwks.keys[0].x,jwks.keys[0].y));
});
