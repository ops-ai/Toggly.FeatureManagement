import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {effectScope} from 'vue';
import {get} from 'svelte/store';
import {useVariant as useReactVariant} from '../../frameworks/react/Feature.js';
import {useVariant as useVueVariant, useFeatureGate as useVueGate} from '../../frameworks/vue/composables.js';
import {featureVariant} from '../../frameworks/svelte/stores.js';
import * as store from '../../client/store.js';
let root:Root|undefined;let element:HTMLDivElement;let bodies:any[]=[];
beforeEach(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 element=document.createElement('div');document.body.append(element);bodies=[];
 vi.stubGlobal('CompressionStream',undefined);
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>url.includes('/api/frontend/telemetry')?(bodies.push(JSON.parse(init!.body as string)),{status:202}):{ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({defs:{Experiment:{enabled:true,variant:'control',configurationValue:3}}})}));
 await store.initTogglyClient({appKey:'app',environment:'Test',enableVariants:true,featureFlagsRefreshInterval:0,enableLiveUpdates:false});
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;element.remove();store.__resetClient();await Promise.resolve();vi.unstubAllGlobals();});
it('React Vue and Svelte variants share one effective evaluator and reporter',async()=>{
 function Island(){const value=useReactVariant('Experiment');return <span>{value?.name??'none'}</span>;}
 await act(async()=>{root=createRoot(element);root.render(<Island/>);});
 const scope=effectScope();const value=scope.run(()=>useVueVariant('Experiment'))!;
 expect(value.value?.name).toBe('control');expect(get(featureVariant('Experiment'))?.name).toBe('control');
 await store.flushTelemetry();expect(bodies).toEqual([{k:'app',e:'Test',f:{Experiment:{control:[3]}}}]);bodies.length=0;
 await act(async()=>{store.setLocalGates([{id:'local',flagKeys:['Experiment'],isEnabled:()=>false}]);store.notifyLocalGatesChanged();});
 expect(element.textContent).toBe('none');expect(value.value).toBeNull();expect(get(featureVariant('Experiment'))).toBeNull();
 await store.flushTelemetry();expect(bodies).toEqual([{k:'app',e:'Test',f:{Experiment:{disabled:[3]}}}]);scope.stop();
});

it('Vue gate consumers count each effective refresh once instead of reading a silent warm projection',async()=>{
 const scope=effectScope();const value=scope.run(()=>useVueGate(['Experiment']))!;
 expect(value.enabled.value).toBe(true);await store.flushTelemetry();expect(bodies[0].f.Experiment.control).toEqual([1]);bodies=[];
 await store.refreshFlags();expect(value.enabled.value).toBe(true);await store.flushTelemetry();
 expect(bodies).toEqual([{k:'app',e:'Test',f:{Experiment:{control:[1]}}}]);scope.stop();
});
