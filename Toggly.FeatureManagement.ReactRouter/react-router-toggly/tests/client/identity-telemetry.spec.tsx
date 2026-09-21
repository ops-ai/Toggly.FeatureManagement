import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { TogglyProvider, useTogglyContext, type TogglyContextValue } from '../../src/client/context';
import { FeatureSwitch } from '../../src/client/components/Feature';
import type { TogglyConfig } from '../../src/core';

let current: TogglyContextValue;
let bodies: any[];
const config: TogglyConfig = {appKey:'identity-app',environment:'Test',baseUrl:'https://definitions.test',metricsBaseUrl:'https://collector.test',featureDefaults:{Safe:true}};
const snapshot = {flags:{On:true,Off:false},identity:'alice',fetchedAt:1};
function Capture(){current=useTogglyContext();return null;}
const transport = async(url:string,init?:RequestInit) => {
  if(url.includes('/api/frontend/telemetry')){bodies.push(JSON.parse(init!.body as string));return {status:202};}
  return {ok:true,status:200,json:async()=>({On:false,Off:false})};
};
beforeEach(()=>{
  bodies=[];
  Object.defineProperty(globalThis,'CompressionStream',{configurable:true,value:undefined});
  Object.defineProperty(globalThis,'WebSocket',{configurable:true,value:undefined});
  (fetch as jest.Mock).mockImplementation(transport);
});

test('forwards minted targeting and preserves old queues across rotate, client identity and reset',async()=>{
  const view=render(<TogglyProvider config={{...config,instanceId:'token-a',identity:'private',groups:['staff'],claims:{plan:'pro'}}}><Capture/></TogglyProvider>);
  await waitFor(()=>expect(current.isReady).toBe(true));
  let url=new URL((fetch as jest.Mock).mock.calls[0][0]);
  expect(url.searchParams.get('i')).toBe('token-a');
  for(const key of ['u','userId','g','claim.plan']) expect(url.searchParams.has(key)).toBe(false);
  current.setGauge('cart',1);
  await act(async()=>{await current.identify('alice',{instanceId:'token-b'});}); current.setGauge('cart',2);
  await act(async()=>{await current.identify('bob',{groups:['users'],claims:{plan:'basic'}});}); current.setGauge('cart',3);
  url=new URL((fetch as jest.Mock).mock.calls[2][0]);
  expect(url.searchParams.get('u')).toBe('bob'); expect(url.searchParams.has('i')).toBe(false);
  expect(url.searchParams.get('g')).toBe('users');expect(url.searchParams.get('claim.plan')).toBe('basic');
  await act(async()=>{await current.reset();}); current.setGauge('cart',4);
  await current.flushTelemetry();
  expect(bodies.map(body=>[body.i,body.u,body.m.cart])).toEqual([['token-a',undefined,1],['token-b',undefined,2],[undefined,'bob',3],[undefined,undefined,4]]);
  view.unmount();
});

test.each(['local','entity'])('captures old flags and attribution before a reentrant %s callback',async boundary=>{
  let transition:Promise<void>|undefined;
  const flags=boundary==='entity'?{On:{requirement:'all',rules:[{property:'plan',op:'eq',value:'pro',type:'string'}]}}:snapshot.flags;
  const view=render(<TogglyProvider config={config} serverContext={{...snapshot,flags}}><Capture/></TogglyProvider>);
  if(boundary==='local') current.setLocalGates([{id:'switch',flagKeys:['On'],isEnabled:()=>{transition=current.identify('bob');current.recordUsage('New');return true;}}]);
  else current.registerContext('Account',()=>{transition=current.identify('bob');current.recordUsage('New');return {kind:'Account',attributes:{plan:'pro'}};});
  act(()=>{expect(current.isEnabled('On',false,boundary==='entity'?{}:undefined,boundary==='entity'?'Account':undefined)).toBe(true);});
  await act(async()=>{await transition;}); await current.flushTelemetry();
  expect(bodies.find(body=>body.f?.On)?.u).toBe('alice');
  expect(bodies.find(body=>body.f?.New)?.u).toBe('bob');
  expect(current.flags.On).toBe(false);
  view.unmount();
});

test('failed identity refresh keeps new scope defaults and the existing resolved Promise contract',async()=>{
  const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
  const view=render(<TogglyProvider config={{...config,instanceId:'old-token'}} serverContext={snapshot}><Capture/></TogglyProvider>);
  (fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await act(async()=>{await expect(current.identify('bob')).resolves.toBeUndefined();});
  expect(current.identity).toBe('bob'); expect(current.flags).toEqual({Safe:true}); expect(current.isEnabled('On')).toBe(false);
  current.recordUsage('New');await current.flushTelemetry();expect(bodies[0].u).toBe('bob');expect(bodies[0].i).toBeUndefined();
  view.unmount();warn.mockRestore();
});

test('ignores a late old refresh after token replacement without hydration checks',async()=>{
  const changed=jest.fn();
  const view=render(<TogglyProvider config={config} serverContext={snapshot} onFlagsChange={changed}><Capture/></TogglyProvider>);
  let finish!:(value:unknown)=>void;
  (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  let old!:Promise<void>;act(()=>{old=current.refresh();});
  await act(async()=>{await current.identify('bob',{instanceId:'new-token'});});
  await act(async()=>{finish({ok:true,json:async()=>({On:true})});await old;});
  expect(current.flags.On).toBe(false);expect(changed).toHaveBeenCalledTimes(1);
  await current.flushTelemetry();expect(bodies).toEqual([]);view.unmount();
});


test.each(['endpoint','transport','disabled'])('retires incompatible telemetry without flushing pending old data: %s',async change=>{
  const firstFetch=jest.fn(transport),secondFetch=jest.fn(transport);
  const original={...config,telemetryFetch:firstFetch as typeof fetch};
  const view=render(<TogglyProvider config={original} serverContext={snapshot}><Capture/></TogglyProvider>);
  current.recordUsage('Retired');const old=current;
  const replacement=change==='endpoint'?{...original,metricsBaseUrl:'https://other-collector.test'}:change==='transport'?{...original,telemetryFetch:secondFetch as typeof fetch}:{...original,enableTelemetry:false};
  view.rerender(<TogglyProvider config={replacement} serverContext={snapshot}><Capture/></TogglyProvider>);
  await act(async()=>{});await old.flushTelemetry();
  expect(firstFetch).not.toHaveBeenCalled();expect(bodies).toEqual([]);
  current.recordUsage('Current');await current.flushTelemetry();
  expect(bodies.map(body=>body.f)).toEqual(change==='disabled'?[]:[{Current:{enabled:[0,1]}}]);
  view.unmount();
});

test('captures all short-circuited gate leaves before a context-changing mapper',async()=>{
  let transition:Promise<void>|undefined;
  const view=render(<TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider>);
  current.registerContext('GateAccount',()=>{transition=current.identify('bob');return {};});
  act(()=>{expect(current.evaluateGate(['On','Off','Skipped'],'all',true,{},'GateAccount')).toBe(true);});
  await act(async()=>{await transition;});await current.flushTelemetry();
  expect(bodies).toEqual([{k:'identity-app',e:'Test',u:'alice',f:{On:{enabled:[1]}}},{k:'identity-app',e:'Test',u:'alice',f:{Off:{disabled:[1]}}}]);
  view.unmount();
});

test('reset supersedes pending initialization and completes readiness for the new scope',async()=>{
  let finish!:(value:unknown)=>void;
  (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<TogglyProvider config={{...config,identity:'old',instanceId:'old-token'}}><Capture/></TogglyProvider>);
  expect(current.isReady).toBe(false);
  await act(async()=>{await current.reset();});
  expect(current.isReady).toBe(true);expect(current.identity).toBeUndefined();expect(current.flags.On).toBe(false);
  await act(async()=>{finish({ok:true,json:async()=>({On:true})});});
  expect(current.flags.On).toBe(false);
  view.unmount();
});

test.each(['direct', 'multi-leaf'])('captures immutable selected flags across public mutation: %s', async boundary => {
  const view = render(<TogglyProvider config={config} serverContext={{...snapshot, flags:{On:true,Next:true}}}><Capture/></TogglyProvider>);
  if (boundary === 'direct') {
    current.registerContext('MutableSelection', () => { current.flags.On = false; return {}; });
    expect(current.isEnabled('On', false, {}, 'MutableSelection')).toBe(true);
  } else {
    current.setLocalGates([{id:'mutate',flagKeys:['On'],isEnabled:()=>{current.flags.Next=false;return true;}}]);
    expect(current.evaluateGate(['On','Next'])).toBe(true);
  }
  await current.flushTelemetry();
  expect(Object.assign({}, ...bodies.map(body=>body.f))).toEqual(boundary === 'direct' ? {On:{enabled:[1]}} : {On:{enabled:[1]},Next:{enabled:[1]}});
  expect(bodies.every(body=>body.u==='alice')).toBe(true);
  view.unmount();
});

test('only the newest same-context refresh publishes state and callbacks', async () => {
  const changed = jest.fn();
  const view = render(<TogglyProvider config={config} serverContext={snapshot} onFlagsChange={changed}><Capture/></TogglyProvider>);
  let release!:(value:unknown)=>void;
  (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  let old!:Promise<void>; act(()=>{old=current.refresh();});
  await act(async()=>{await current.refresh();});
  await act(async()=>{release({ok:true,json:async()=>({On:true})});await old;});
  expect(current.flags.On).toBe(false); expect(changed.mock.calls.map(call=>call[0].On)).toEqual([false]);
  await current.flushTelemetry(); expect(bodies).toEqual([]);
  view.unmount();
});

test('a superseded afterRefresh completion cannot publish a stale callback', async () => {
  const changed = jest.fn();
  const view = render(<TogglyProvider config={config} serverContext={snapshot} onFlagsChange={changed}><Capture/></TogglyProvider>);
  let release!:()=>void; let hold = true;
  act(()=>current.addHook({getMetadata:()=>({name:'held'}),afterRefresh:()=>hold?new Promise<void>(resolve=>{release=resolve;}):undefined}));
  (fetch as jest.Mock).mockResolvedValueOnce({ok:true,json:async()=>({On:true})});
  let old!:Promise<void>;
  await act(async()=>{old=current.refresh();});
  await waitFor(()=>expect(release).toBeDefined());
  hold=false;
  await act(async()=>{await current.refresh();});
  await act(async()=>{release();await old;});
  expect(current.flags.On).toBe(false); expect(changed.mock.calls.map(call=>call[0].On)).toEqual([false]);
  await current.flushTelemetry(); expect(bodies).toEqual([]);
  view.unmount();
});

test('mounted consumers render and count only the winning out-of-order refresh', async () => {
  const view = render(<TogglyProvider config={config} serverContext={snapshot}><Capture/><FeatureSwitch featureKey="On" enabled="visible-on" disabled="visible-off"/></TogglyProvider>);
  await current.flushTelemetry(); bodies=[];
  let release!:(value:unknown)=>void;
  (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  let old!:Promise<void>;act(()=>{old=current.refresh();});
  await act(async()=>{await current.refresh();});
  expect(view.getByText('visible-off')).toBeTruthy();
  await act(async()=>{release({ok:true,json:async()=>({On:true})});await old;});
  expect(view.getByText('visible-off')).toBeTruthy();
  await current.flushTelemetry();
  expect(bodies).toEqual([{k:'identity-app',e:'Test',u:'alice',f:{On:{disabled:[1]}}}]);
  view.unmount();
});

test('keeps nested entity rules immutable while an entity mapper mutates the public definition', async () => {
  const definition = {requirement:'all' as const,rules:[{property:'plan',op:'eq',value:'pro',type:'string'}]};
  const view = render(<TogglyProvider config={config} serverContext={{...snapshot,flags:{On:definition}}}><Capture/></TogglyProvider>);
  current.registerContext('NestedMutation',()=>{(current.flags.On as typeof definition).rules[0].value='other';return {attributes:{plan:'pro'}};});
  expect(current.isEnabled('On',false,{},'NestedMutation')).toBe(true);
  await current.flushTelemetry();
  expect(bodies).toEqual([{k:'identity-app',e:'Test',u:'alice',f:{On:{enabled:[1]}}}]);
  view.unmount();
});
