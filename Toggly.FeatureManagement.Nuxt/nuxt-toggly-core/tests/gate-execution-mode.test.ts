import {afterEach,expect,it,vi} from 'vitest'
import {createTogglyClient as browser} from '../src/browser'
import {createTogglyClient as base} from '../src/client'
afterEach(()=>vi.unstubAllGlobals())
it.each([false,true])('preserves trusted eager hook and leaf check ordering with reporting=%s',async enabled=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({First:false,Later:true}))))
 const order:string[]=[]
 const client=base({appKey:'test',refreshInterval:0,enableLiveUpdates:false,enableUsageTracking:enabled,trustedTelemetryFactory:()=>({usageEnabled:true,start(){},close:async()=>{},recordCheck:(key:string)=>{order.push(`check:${key}`)},recordDefinitionCacheHit(){},recordDefinitionCacheMiss(){}} as any),hooks:[{getMetadata:()=>({name:'order'}),beforeEvaluation:key=>{order.push(`before:${key}`)},afterEvaluation:key=>{order.push(`after:${key}`)}}]})
 try{await client.init();order.length=0;expect(await client.evaluateFeatureGate(['First','Later'])).toBe(false);await Promise.resolve();expect(order).toEqual(['before:First','before:Later',...(enabled?['check:First','check:Later']:[]),'after:First','after:Later'])}finally{client.destroy()}
})
it.each([false,true])('browser effective short circuit is independent of reporting=%s',async enabled=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({First:false,Later:true}))))
 const order:string[]=[];const client=browser({appKey:'test',refreshInterval:0,enableLiveUpdates:false,enableTelemetry:enabled,hooks:[{getMetadata:()=>({name:'order'}),beforeEvaluation:key=>{order.push(`before:${key}`)},afterEvaluation:key=>{order.push(`after:${key}`)}}]})
 try{await client.init();expect(await client.evaluateFeatureGate(['First','Later'])).toBe(false);await Promise.resolve();expect(order).toEqual(['before:First','after:First'])}finally{client.destroy()}
})
