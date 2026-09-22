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

test('removes every repeated targeting query key from a captured key list', async () => {
  const view = render(<TogglyProvider config={{...config, instanceId:'minted', baseUrl:'https://definitions.test/base?u=a&u=b&userId=c&userId=d&g=e&g=f&claim.plan=g&claim.plan=h&keep=one&keep=two'}}><Capture/></TogglyProvider>);
  await waitFor(()=>expect(current.isReady).toBe(true));
  const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
  for (const key of ['u','userId','g','claim.plan']) expect(url.searchParams.getAll(key)).toEqual([]);
  expect(url.searchParams.getAll('i')).toEqual(['minted']);
  expect(url.searchParams.getAll('keep')).toHaveLength(2);
  view.unmount();
});

test('preserves forward before hooks, reverse after hooks and isolated hook failures', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(()=>{});
  const order:string[] = [];
  const view = render(<TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider>);
  act(()=>{
    current.addHook({getMetadata:()=>({name:'first'}),beforeIdentify:async identity=>{order.push('before:first:'+identity);throw Error('first before');},afterIdentify:async identity=>{order.push('after:first:'+identity);}});
    current.addHook({getMetadata:()=>({name:'second'}),beforeIdentify:async identity=>{order.push('before:second:'+identity);},afterIdentify:async identity=>{order.push('after:second:'+identity);throw Error('second after');}});
  });
  try {
    await act(async()=>{await current.identify('bob');});
    expect(order).toEqual(['before:first:bob','before:second:bob','after:second:bob','after:first:bob']);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(current.identity).toBe('bob');expect(current.flags.On).toBe(false);
    current.recordUsage('Accepted');await current.flushTelemetry();
    expect(bodies).toEqual([{k:'identity-app',e:'Test',u:'bob',f:{Accepted:{enabled:[0,1]}}}]);
  } finally {view.unmount();errors.mockRestore();}
});

test.each(['before','after'])('preserves identify ownership when a %s hook reenters identify', async phase => {
  const order:string[] = [];let successor:Promise<void>|undefined;
  const view = render(<TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider>);
  act(()=>{
    current.addHook({getMetadata:()=>({name:'first'}),beforeIdentify:identity=>{order.push('before:first:'+identity);if(phase==='before'&&identity==='bob')successor=current.identify('carol');},afterIdentify:identity=>{order.push('after:first:'+identity);}});
    current.addHook({getMetadata:()=>({name:'second'}),beforeIdentify:identity=>{order.push('before:second:'+identity);},afterIdentify:identity=>{order.push('after:second:'+identity);if(phase==='after'&&identity==='bob')successor=current.identify('carol');}});
  });
  await act(async()=>{await current.identify('bob');await successor;});
  expect(current.identity).toBe('carol');expect(current.flags.On).toBe(false);
  expect(order).not.toContain('after:first:bob');
  if(phase==='before')expect(order).not.toContain('before:second:bob');
  expect(order.filter(value=>value.endsWith(':carol'))).toEqual(['before:first:carol','before:second:carol','after:second:carol','after:first:carol']);
  view.unmount();
});

test('single and multi-leaf checks do not copy unrelated definitions or gate callbacks', () => {
  const unrelated = jest.fn(()=>true);
  const flags = {On:true, Next:true};
  Object.defineProperty(flags, 'Unrelated', {enumerable:true, get:unrelated});
  const unusedGate = {id:'unused',flagKeys:['Unrelated'],get isEnabled(){unrelated();return ()=>true;}};
  const view = render(<TogglyProvider config={config} serverContext={{...snapshot,flags}}><Capture/></TogglyProvider>);
  current.setLocalGates([unusedGate]);
  unrelated.mockClear();
  expect(current.isEnabled('On')).toBe(true);
  expect(current.evaluateGate(['On','Next'])).toBe(true);
  expect(current.isEnabled('Missing', true)).toBe(true);
  expect(unrelated).not.toHaveBeenCalled();
  view.unmount();
});

test('captures selected gate callbacks and caller keys before reentrant mapper mutation', async () => {
  const view = render(<TogglyProvider config={config} serverContext={{...snapshot,flags:{On:true,Next:true}}}><Capture/></TogglyProvider>);
  const gate={id:'selected',flagKeys:['Next'],isEnabled:()=>true};
  const keys=['On','Next'];
  current.setLocalGates([gate]);
  current.registerContext('SelectedCallbacks',()=>{gate.isEnabled=()=>false;keys.push('Missing');return {};});
  expect(current.evaluateGate(keys,'all',false,{},'SelectedCallbacks')).toBe(true);
  expect(current.isEnabled('Next')).toBe(false);
  await current.flushTelemetry();
  const counts=bodies.flatMap(body=>Object.keys(body.f??{}));
  expect(counts).not.toContain('Missing');
  view.unmount();
});

test('syncs changed and omitted targeting props before a descendant passive refresh', async () => {
  function RefreshAfterCommit({revision}:{revision:number}) {
    const client=useTogglyContext();
    React.useEffect(()=>{if(revision)void client.refresh();},[revision]);
    return <Capture/>;
  }
  const original={...config,groups:['old'],claims:{plan:'basic'}};
  const view=render(<TogglyProvider config={original} serverContext={snapshot}><RefreshAfterCommit revision={0}/></TogglyProvider>);
  view.rerender(<TogglyProvider config={{...original,groups:['new'],claims:{plan:'paid'}}} serverContext={snapshot}><RefreshAfterCommit revision={1}/></TogglyProvider>);
  await waitFor(()=>expect(current.isReady).toBe(true));
  let url=new URL((fetch as jest.Mock).mock.calls.at(-1)![0]);
  expect(url.searchParams.getAll('g')).toEqual(['new']);expect(url.searchParams.get('claim.plan')).toBe('paid');
  view.rerender(<TogglyProvider config={config} serverContext={snapshot}><RefreshAfterCommit revision={2}/></TogglyProvider>);
  await waitFor(()=>expect(current.isReady).toBe(true));
  url=new URL((fetch as jest.Mock).mock.calls.at(-1)![0]);
  expect(url.searchParams.has('g')).toBe(false);expect(url.searchParams.has('claim.plan')).toBe(false);
  view.unmount();
});

test('equivalent targeting props preserve identify overrides and changed fields stay on the same owner', async () => {
  const original={...config,instanceId:'initial-token',groups:['configured'],claims:{plan:'basic',region:'us'}};
  const view=render(<TogglyProvider config={original} serverContext={snapshot}><Capture/></TogglyProvider>);
  const hook=jest.fn();
  act(()=>current.addHook({getMetadata:()=>({name:'retained'}),beforeIdentify:hook}));
  current.recordUsage('Before');
  await act(async()=>{await current.identify('bob',{groups:['explicit'],claims:{plan:'explicit'}});});
  view.rerender(<TogglyProvider config={{...original,groups:['configured'],claims:{region:'us',plan:'basic'}}} serverContext={snapshot}><Capture/></TogglyProvider>);
  await act(async()=>{await current.refresh();});
  let url=new URL((fetch as jest.Mock).mock.calls.at(-1)![0]);
  expect(url.searchParams.getAll('g')).toEqual(['explicit']);expect(url.searchParams.get('claim.plan')).toBe('explicit');
  const requests=(fetch as jest.Mock).mock.calls.length;
  view.rerender(<TogglyProvider config={{...original,groups:['changed']}} serverContext={snapshot}><Capture/></TogglyProvider>);
  expect((fetch as jest.Mock).mock.calls).toHaveLength(requests);
  expect(current.isReady).toBe(false);expect(current.flags).toEqual({Safe:true});expect(current.identity).toBe('bob');
  await act(async()=>{await current.refresh();});
  url=new URL((fetch as jest.Mock).mock.calls.at(-1)![0]);
  expect(url.searchParams.getAll('g')).toEqual(['changed']);expect(url.searchParams.get('claim.plan')).toBe('explicit');
  expect(url.searchParams.get('u')).toBe('bob');expect(url.searchParams.has('i')).toBe(false);
  current.recordUsage('After');await current.flushTelemetry();
  expect(bodies.map(body=>[body.i,body.u,Object.keys(body.f)])).toEqual([['initial-token',undefined,['Before']],[undefined,'bob',['After']]]);
  await act(async()=>{await current.identify('next',{instanceId:'minted'});});
  expect(hook).toHaveBeenCalledTimes(2);
  view.rerender(<TogglyProvider config={{...original,groups:['changed'],claims:{plan:'new'}}} serverContext={snapshot}><Capture/></TogglyProvider>);
  await act(async()=>{await current.refresh();});
  url=new URL((fetch as jest.Mock).mock.calls.at(-1)![0]);
  expect(url.searchParams.get('i')).toBe('minted');expect(url.searchParams.has('u')).toBe(false);expect(url.searchParams.has('claim.plan')).toBe(false);
  view.unmount();
});

test.each(['response','hook'])('targeting prop commit retires an older pending %s', async boundary => {
  const changed=jest.fn();
  const view=render(<TogglyProvider config={config} serverContext={snapshot} onFlagsChange={changed}><Capture/></TogglyProvider>);
  let release!:(value?:any)=>void;
  if(boundary==='response') (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  else act(()=>current.addHook({getMetadata:()=>({name:'held-props'}),afterRefresh:()=>new Promise<void>(resolve=>{release=resolve;})}));
  let pending!:Promise<void>;await act(async()=>{pending=current.refresh();});
  await waitFor(()=>expect(release).toBeDefined());
  view.rerender(<TogglyProvider config={{...config,claims:{plan:'new'}}} serverContext={snapshot} onFlagsChange={changed}><Capture/></TogglyProvider>);
  expect(current.isReady).toBe(false);expect(current.flags).toEqual({Safe:true});
  await act(async()=>{release({ok:true,json:async()=>({On:true})});await pending;});
  expect(current.isReady).toBe(false);expect(current.flags).toEqual({Safe:true});expect(changed).not.toHaveBeenCalled();
  view.unmount();
});

test('abandoned targeting prop render cannot replace committed request context', async () => {
  const original={...config,groups:['committed']};
  function MaybeSuspended({suspend}:{suspend:boolean}) {if(suspend)throw new Promise(()=>{});return <Capture/>;}
  const tree=(suspend:boolean)=><React.Suspense fallback="waiting"><TogglyProvider config={suspend?{...original,groups:['abandoned']}:original} serverContext={snapshot}><MaybeSuspended suspend={suspend}/></TogglyProvider></React.Suspense>;
  const view=render(tree(false));
  view.rerender(tree(true));
  await act(async()=>{await current.refresh();});
  const url=new URL((fetch as jest.Mock).mock.calls.at(-1)![0]);
  expect(url.searchParams.getAll('g')).toEqual(['committed']);
  view.unmount();
});

test('selected local gates retain first-id resolution and observe mutation at the next public check', () => {
  const first={id:'shared',flagKeys:['Unrelated'],isEnabled:()=>false};
  const second={id:'shared',flagKeys:['On'],isEnabled:()=>true};
  const view=render(<TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider>);
  current.setLocalGates([first,second]);
  expect(current.isEnabled('On')).toBe(false);
  first.isEnabled=()=>true;
  expect(current.isEnabled('On')).toBe(true);
  view.unmount();
});
