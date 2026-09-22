import React from 'react';
import {render,waitFor,act} from '@testing-library/react';
import {TogglyProvider} from '../src/components/TogglyProvider';
import {useToggly} from '../src/hooks/useToggly';
import {useFeatureFlag,useFeatureGate} from '../src/hooks/useFeatureFlag';
import {useTogglyContext} from '../src/contexts/TogglyContext';
let api: ReturnType<typeof useToggly>;
function Child(){api=useToggly();const flag=useFeatureFlag('On');return <span>{flag.isEnabled?'ON':'OFF'}</span>}
const packets:any[]=[];const requests:{url:URL,signal:AbortSignal}[]=[];
const settings={appKey:'native',environment:'Test',identity:'alice',baseURI:'https://defs.test/base?i=retired&i=older&keep=ok',metricsBaseUrl:'https://collector.test',refreshInterval:0,enableLiveUpdates:false,featureDefaults:{On:false}};
const response=(On:boolean)=>({status:200,ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({On})});
beforeEach(()=>{api=undefined as unknown as typeof api;packets.length=0;requests.length=0;Object.defineProperty(globalThis,'CompressionStream',{value:undefined,configurable:true});
(fetch as jest.Mock).mockImplementation(async(input:string,init:RequestInit)=>{if(input.includes('/api/frontend/telemetry')){packets.push(JSON.parse(String(init.body)));return {status:202}}requests.push({url:new URL(input),signal:init.signal!});return response(new URL(input).searchParams.get('i')==='A')})});
it('forwards token props before initial network work completes, then exposes context clearing through useToggly',async()=>{
 let release!:(value:unknown)=>void;
 (fetch as jest.Mock).mockImplementation(async(input:string,init:RequestInit)=>{if(input.includes('/api/frontend/telemetry')){packets.push(JSON.parse(String(init.body)));return {status:202}}requests.push({url:new URL(input),signal:init.signal!});if(new URL(input).searchParams.get('i')==='A')return new Promise(resolve=>{release=resolve});return response(false)});
 const view=render(<TogglyProvider {...settings} instanceId="A" waitForInit={false}><Child/></TogglyProvider>);
 await waitFor(()=>expect(release).toBeDefined());
 view.rerender(<TogglyProvider {...settings} instanceId="B" waitForInit={false}><Child/></TogglyProvider>);
 await waitFor(()=>expect(requests.some(r=>r.url.searchParams.get('i')==='B')).toBe(true));
 await waitFor(()=>expect(api.isReady).toBe(true));
 await act(async()=>{release(response(true));await Promise.resolve()});
 expect(view.queryByText('ON')).toBeNull();expect(api.features).toEqual({On:false});expect(requests[0].signal.aborted).toBe(true);
 await act(async()=>{api.recordUsage('After');await api.flushTelemetry()});
 expect(packets).toEqual([{k:'native',e:'Test',i:'B',f:{On:{disabled:[1]},After:{enabled:[0,1]}}}]);
 await act(async()=>{await api.setContext({instanceId:'',identity:'bob'});api.recordView('Cleared');await api.flushTelemetry()});
 expect(requests.at(-1)!.url.searchParams.has('i')).toBe(false);expect(requests.at(-1)!.url.searchParams.get('u')).toBe('bob');
 expect(packets.at(-1).u).toBe('bob');expect(packets.at(-1).i).toBeUndefined();expect(packets.at(-1).f.Cleared.enabled).toEqual([0,0,1]);
 view.unmount();
});
it('cancels queued old-owner delivery on app replacement and immediately admits the new owner',async()=>{
 const view=render(<TogglyProvider {...settings} instanceId="A"><Child/></TogglyProvider>);
 await waitFor(()=>expect(view.queryByText('ON')).not.toBeNull());await act(async()=>{await api.flushTelemetry()});packets.length=0;
 act(()=>api.recordUsage('Retired'));
 view.rerender(<TogglyProvider {...settings} appKey="new" environment="New" instanceId="B"><Child/></TogglyProvider>);
 await waitFor(()=>expect(view.queryByText('OFF')).not.toBeNull());await act(async()=>{api.recordUsage('Current');await api.flushTelemetry()});
 expect(packets).toEqual([{k:'new',e:'New',i:'B',f:{On:{disabled:[1]},Current:{enabled:[0,1]}}}]);
 view.unmount();
});
it('preserves imperative identity when only the token prop changes and clears',async()=>{
 const view=render(<TogglyProvider {...settings} identity={undefined} instanceId="A"><Child/></TogglyProvider>);
 await waitFor(()=>expect(api.isReady).toBe(true));
 await act(async()=>{await api.setIdentity('bob')});expect(api.identity).toBe('bob');
 view.rerender(<TogglyProvider {...settings} identity={undefined} instanceId="B"><Child/></TogglyProvider>);
 await waitFor(()=>expect(requests.at(-1)!.url.searchParams.get('i')).toBe('B'));
 expect(api.identity).toBe('bob');
 view.rerender(<TogglyProvider {...settings} identity={undefined}><Child/></TogglyProvider>);
 await waitFor(()=>expect(requests.at(-1)!.url.searchParams.has('i')).toBe(false));
 expect(requests.at(-1)!.url.searchParams.get('u')).toBe('bob');
 await act(async()=>{api.recordView('retained');await api.flushTelemetry()});expect(packets.at(-1).u).toBe('bob');expect(packets.at(-1).f.retained.enabled).toEqual([0,0,1]);
 view.unmount();
});

it.each([false,true])('synchronizes the early public snapshot after initialization (offline=%s)',async(offline)=>{
 let ready!:()=>void;
 (fetch as jest.Mock).mockImplementation(async()=>{await new Promise<void>(resolve=>{ready=resolve});if(offline)throw new Error('offline');return response(true)});
 function Snapshot(){api=useToggly();return <span>{api.isReady?'ready':'waiting'}</span>}
 const view=render(<TogglyProvider {...settings} identity={undefined} featureDefaults={{On:true}} waitForInit={false}><Snapshot/></TogglyProvider>);
 await waitFor(()=>expect(ready).toBeDefined());expect(api.features).toBeNull();
 await act(async()=>{ready()});
 await waitFor(()=>expect(api.isReady).toBe(true));
 expect(api.features).toEqual({On:true});expect(api.identity).toMatch(/^[a-f0-9-]{36}$/);
 expect(await api.isFeatureOn('On')).toBe(true);view.unmount();
});
it.each(['flag','gate'] as const)('counts one real %s refresh and preserves local updates and no-event offline evaluation',async(kind)=>{
 let hook!:ReturnType<typeof useFeatureFlag>;let core!:ReturnType<typeof useTogglyContext>['toggly'];
 let network!:(state:{isConnected:boolean})=>void;let allowed=true;
 const networkInfo={getState:async()=>({isConnected:true}),subscribe:(listener:typeof network)=>{network=listener;return()=>{}}};
 function Reader(){api=useToggly();core=useTogglyContext().toggly;hook=kind==='flag'?useFeatureFlag('On'):useFeatureGate(['On','Skipped']);return <span>{String(hook.isEnabled)}</span>}
 const view=render(<TogglyProvider {...settings} instanceId="A" networkInfo={networkInfo}><Reader/></TogglyProvider>);
 await waitFor(()=>expect(hook.isLoading).toBe(false));await act(async()=>{await api.flushTelemetry()});packets.length=0;
 await act(async()=>{await hook.refresh();await api.flushTelemetry()});
 expect(packets).toHaveLength(1);expect(packets[0].f).toEqual(kind==='flag'?{On:{enabled:[1]}}:{On:{enabled:[1]},Skipped:{disabled:[1]}});packets.length=0;
 await act(async()=>{core.setLocalGates([{id:'local',flagKeys:['On'],isEnabled:()=>allowed}])});await api.flushTelemetry();packets.length=0;
 allowed=false;await act(async()=>{core.notifyLocalGatesChanged()});await api.flushTelemetry();
 expect(hook.isEnabled).toBe(false);expect(packets[0].f.On.disabled).toEqual([1]);expect(packets[0].f.Skipped).toBeUndefined();packets.length=0;
 act(()=>network({isConnected:false}));
 await act(async()=>{await hook.refresh();await api.flushTelemetry()});
 expect(packets).toHaveLength(1);expect(packets[0].f.On.disabled).toEqual([1]);expect(packets[0].f.Skipped).toBeUndefined();
 view.unmount();
});

it.each(['flag','gate'] as const)('awaits the effective %s refresh evaluation and counts entity veto once',async(kind)=>{
 let hook!:ReturnType<typeof useFeatureFlag>;let core!:ReturnType<typeof useTogglyContext>['toggly'];let release!:()=>void;
 const entity={kind:'User',key:'one',attributes:{role:'guest'}};
 (fetch as jest.Mock).mockImplementation(async(input:string,init:RequestInit)=>{if(input.includes('/api/frontend/telemetry')){packets.push(JSON.parse(String(init.body)));return {status:202}}return {status:200,ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({On:{requirement:'all',rules:[{property:'role',op:'eq',value:'admin'}]},Skipped:true})}});
 function Reader(){api=useToggly();core=useTogglyContext().toggly;hook=kind==='flag'?useFeatureFlag('On',{context:entity}):useFeatureGate(['On','Skipped'],{context:entity});return null}
 const view=render(<TogglyProvider {...settings} instanceId="A"><Reader/></TogglyProvider>);
 await waitFor(()=>expect(hook.isLoading).toBe(false));await api.flushTelemetry();packets.length=0;
 core.addHook({getMetadata:()=>({name:'hold'}),beforeEvaluation:()=>new Promise<void>(resolve=>{release=resolve})});
 let settled=false;let pending!:Promise<void>;
 act(()=>{pending=hook.refresh().then(()=>{settled=true})});
 await waitFor(()=>expect(release).toBeDefined());expect(settled).toBe(false);
 await act(async()=>{release();await pending});await api.flushTelemetry();
 expect(hook.isLoading).toBe(false);expect(hook.isEnabled).toBe(false);expect(packets).toEqual([{k:'native',e:'Test',i:'A',f:{On:{disabled:[1]}}}]);view.unmount();
});
