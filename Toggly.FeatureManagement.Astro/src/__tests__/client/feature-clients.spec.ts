import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {hydrateFeatureClients,cleanupFeatureClients} from '../../client/feature-clients.js';
import * as store from '../../client/store.js';
let bodies:any[]=[];
beforeEach(async()=>{
 bodies=[];vi.stubGlobal('CompressionStream',undefined);
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>url.includes('/api/frontend/telemetry')?(bodies.push(JSON.parse(init!.body as string)),{status:202}):{ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({On:true,Off:false})}));
 await store.initTogglyClient({appKey:'app',featureFlagsRefreshInterval:0,enableLiveUpdates:false});
 document.body.innerHTML='<div class="toggly-feature-client" data-toggly-feature="On"><div data-toggly-content style="display:none">on</div></div>';
});
afterEach(async()=>{cleanupFeatureClients();document.body.innerHTML='';store.__resetClient();await Promise.resolve();vi.unstubAllGlobals();});
it('duplicate page-load hydration subscribes once and navigation cleanup leaves the owner alive',async()=>{
 hydrateFeatureClients();hydrateFeatureClients();await store.flushTelemetry();
 expect(bodies).toEqual([{k:'app',e:'Production',f:{On:{enabled:[1]}}}]);bodies=[];
 expect((document.querySelector('[data-toggly-content]') as HTMLElement).style.display).toBe('');
 cleanupFeatureClients();await store.refreshFlags();await store.flushTelemetry();expect(bodies).toEqual([]);
 hydrateFeatureClients();await store.flushTelemetry();expect(bodies[0].f.On.enabled).toEqual([1]);
 store.recordUsage('OwnerStillActive');await store.flushTelemetry();expect(bodies[1].f.OwnerStillActive.enabled).toEqual([0,1]);
});
it('readiness and gate subscriptions do not double-count initial hydration',async()=>{
 store.$isReady.set(false);hydrateFeatureClients();await store.flushTelemetry();expect(bodies).toEqual([]);
 store.$isReady.set(true);await store.flushTelemetry();expect(bodies).toEqual([{k:'app',e:'Production',f:{On:{enabled:[1]}}}]);
});
it('native client entity attributes determine effective checks before negation',async()=>{
 store.$flags.set({Entity:{requirement:'all',rules:[{property:'Tier',op:'eq',value:'pro',type:'string'}]}});
 document.body.innerHTML='<div class="toggly-feature-client" data-toggly-feature="Entity" id="allowed"><div data-toggly-content>allowed</div></div><div class="toggly-feature-client" data-toggly-feature="Entity" data-toggly-negate="true" id="denied"><div data-toggly-content>denied</div></div>';
 document.querySelector<HTMLElement>('#allowed')!.dataset.togglyContext=JSON.stringify({kind:'Account',key:'sensitive',attributes:{Tier:'pro'}});
 hydrateFeatureClients();await store.flushTelemetry();
 expect(bodies).toEqual([{k:'app',e:'Production',f:{Entity:{enabled:[1],disabled:[1]}}}]);
 expect(Array.from(document.querySelectorAll<HTMLElement>('[data-toggly-content]')).map(el=>el.style.display)).toEqual(['','']);
});
