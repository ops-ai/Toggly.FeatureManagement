import React, { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { TogglyProvider, useTogglyContext, type TogglyContextValue } from '../../src/client/context';
import { Feature, FeatureGate, FeatureSwitch } from '../../src/client/components/Feature';
import { useABTest, useFeatures } from '../../src/client/hooks';
import type { TogglyConfig } from '../../src/core';

type TelemetryContext = TogglyContextValue & {
  recordUsage(key: string, variant?: string): void;
  recordView(key: string, variant?: string): void;
  incrementCounter(key: string, value?: number): void;
  setGauge(key: string, value: number): void;
  flushTelemetry(): Promise<void>;
};
let current: TelemetryContext;
const bodies: any[] = [];
const owners: TelemetryContext[] = [];
const config = {appKey: 'one', environment: 'Test', baseUrl: 'https://definitions.test', metricsBaseUrl: 'https://collector.test/base'};
const snapshot = {flags: {On: true, Off: false}, identity: 'private-user', fetchedAt: 1};
function Capture() {current = useTogglyContext() as TelemetryContext; owners.push(current); return null;}
const flush = async () => {await act(async () => {await current.flushTelemetry?.();});};
beforeEach(() => {
  bodies.length = 0; owners.length = 0;
  Object.defineProperty(globalThis, 'CompressionStream', {value: undefined, configurable: true});
  Object.defineProperty(globalThis, 'WebSocket', {value: undefined, configurable: true});
  (fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/frontend/telemetry')) {bodies.push({url, init, body: JSON.parse(init!.body as string)}); return {status: 202};}
    return {ok: true, json: async () => snapshot.flags};
  });
});

test('direct effective checks preserve short circuit and negation, explicit metrics carry no identity', async () => {
  const view = render(<TogglyProvider config={config} serverContext={snapshot}><Capture /></TogglyProvider>);
  expect(current.isEnabled('On')).toBe(true);
  expect(current.isDisabled('Off')).toBe(true);
  expect(current.evaluateGate(['Off', 'Skipped'], 'all', true)).toBe(true);
  expect(current.evaluateGate(['On', 'Skipped'], 'any')).toBe(true);
  current.recordUsage?.('On'); current.recordView?.('On', 'control');
  current.incrementCounter?.('orders', 2); current.setGauge?.('cart', 3);
  await flush();
  expect(bodies.map(x => x.body)).toEqual([{k: 'one', e: 'Test', f: {On: {enabled: [2,1], control: [0,0,1]}, Off: {disabled: [2]}}, m: {orders: 2, cart: 3}}]);
  expect(bodies[0].url).toBe('https://collector.test/base/api/frontend/telemetry');
  expect(bodies[0].init.credentials).toBe('omit');
  view.unmount();
});

test('hydrated hook/component leaves count once and never implicitly record usage or views', async () => {
  function Hooks() {useABTest('On', 'a', 'b'); useFeatures(['On','Off']); return <Capture/>;}
  const view = render(<TogglyProvider config={config} serverContext={snapshot}><Hooks/><Feature featureKey="On">yes</Feature><Feature featureKeys={['Off','Skipped']} negate>no</Feature><FeatureGate featureKeys={['On','Skipped']} requirement="any">gate</FeatureGate><FeatureSwitch featureKey="Off" enabled="on" disabled="off"/></TogglyProvider>);
  await flush();
  expect(bodies.map(x => x.body)).toEqual([{k: 'one', e: 'Test', f: {On: {enabled: [4]}, Off: {disabled: [3]}}}]);
  view.unmount();
});

test('local and entity gates produce disabled checks and internal refresh stays silent', async () => {
  const view = render(<TogglyProvider config={{...config, localGates:[{id:'deny',flagKeys:['On'],isEnabled:()=>false}]}} serverContext={snapshot}><Capture/></TogglyProvider>);
  expect(current.isEnabled('On')).toBe(false);
  await act(async()=>{await current.refresh();});
  await flush();
  expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{On:{disabled:[1]}}}]);
  view.unmount();
});

test.each([{enableTelemetry:false},{enableUsageTracking:false,enableMetrics:false},{appKey:undefined}])('disabled owner remains silent: %j', async overrides => {
  const view = render(<TogglyProvider config={{...config,...overrides} as TogglyConfig} serverContext={snapshot}><Capture/></TogglyProvider>);
  current.isEnabled('On'); current.recordUsage?.('On'); current.incrementCounter?.('orders');
  await flush(); view.unmount(); await act(async()=>{});
  expect(bodies).toEqual([]);
});

test('category opt-outs independently suppress usage or metrics', async () => {
  for (const category of ['enableUsageTracking','enableMetrics']) {
    const view = render(<TogglyProvider config={{...config,[category]:false}} serverContext={snapshot}><Capture/></TogglyProvider>);
    current.isEnabled('On'); current.recordUsage?.('On'); current.incrementCounter?.('orders');
    await flush(); view.unmount(); await act(async()=>{});
  }
  expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',m:{orders:1}},{k:'one',e:'Test',f:{On:{enabled:[1,1]}}}]);
});

test('owner replacement starts from new snapshot and final flush retains old labels', async () => {
  function Checked() {const c=useTogglyContext(); c.isEnabled('On'); return <Capture/>;}
  const view=render(<TogglyProvider config={config} serverContext={snapshot}><Checked/></TogglyProvider>);
  const old=current;
  view.rerender(<TogglyProvider config={{...config,appKey:'two',environment:'New'}} serverContext={{...snapshot,flags:{On:false}}}><Checked/></TogglyProvider>);
  await act(async()=>{}); await flush();
  expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{On:{enabled:[1]}}},{k:'two',e:'New',f:{On:{disabled:[1]}}}]);
  old.recordUsage?.('Stale'); await old.flushTelemetry?.(); expect(bodies).toHaveLength(2);
  view.unmount();
});

test('StrictMode replay, concurrent providers, pagehide, true unmount and remount retain independent lifetimes', async () => {
  const view=render(<StrictMode><TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider></StrictMode>);
  const first=current;
  const second=render(<TogglyProvider config={{...config,appKey:'two'}} serverContext={snapshot}><Capture/></TogglyProvider>);
  first.recordUsage?.('First'); current.recordUsage?.('Second');
  view.unmount(); await act(async()=>{});
  expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{First:{enabled:[0,1]}}}]);
  await act(async()=>{window.dispatchEvent(new Event('pagehide'));});
  expect(bodies[1].body).toEqual({k:'two',e:'Test',f:{Second:{enabled:[0,1]}}});
  expect(bodies[1].init.keepalive).toBe(true);
  second.unmount(); await act(async()=>{});
  const remount=render(<TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider>);
  current.recordUsage?.('Again'); await flush(); expect(bodies[2].body.f.Again.enabled).toEqual([0,1]);
  remount.unmount();
});

test('suspended never-committed render remains inert and discarded data never flushes', async () => {
  jest.useFakeTimers();
  function Suspended() {const ctx=useTogglyContext(); ctx.isEnabled('On'); throw new Promise(()=>{});}
  const view=render(<React.Suspense fallback="waiting"><TogglyProvider config={config} serverContext={snapshot}><Suspended/></TogglyProvider></React.Suspense>);
  expect(jest.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  view.unmount(); await act(async()=>{jest.runAllTicks();});
  expect(bodies).toEqual([]);
  jest.useRealTimers();
});

test('invalid active values are rejected without losing accepted events', async () => {
  const view=render(<TogglyProvider config={config} serverContext={snapshot}><Capture/></TogglyProvider>);
  current.incrementCounter('orders',2); current.incrementCounter('orders',1000001);
  current.incrementCounter('orders',NaN); current.setGauge('cart',-1);
  current.recordUsage('On','bad.variant'); current.recordView('On','control');
  await flush(); expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{On:{control:[0,0,1]}},m:{orders:2}}]);
  view.unmount();
});

test('late old refresh and delayed identify do not issue new requests or callbacks after replacement', async () => {
  const changed=jest.fn();
  const view=render(<TogglyProvider config={config} serverContext={snapshot} onFlagsChange={changed}><Capture/></TogglyProvider>);
  let resolveFetch!: (v: unknown)=>void;
  (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{resolveFetch=resolve;}));
  let pending!:Promise<void>;
  act(()=>{pending=current.refresh();});
  const old=current;
  let release!:()=>void;
  act(()=>{current.addHook({getMetadata:()=>({name:'delay'}),beforeIdentify:()=>new Promise<void>(resolve=>{release=resolve;})});});
  let identifying!:Promise<void>;
  act(()=>{identifying=current.identify('late-user');});
  view.rerender(<TogglyProvider config={{...config,appKey:'two'}} serverContext={{...snapshot,flags:{On:false}}} onFlagsChange={changed}><Capture/></TogglyProvider>);
  await act(async()=>{release(); resolveFetch({ok:true,json:async()=>({On:true})}); await pending; await identifying;});
  expect(current.isEnabled('On')).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  await old.refresh();
  expect(fetch).toHaveBeenCalledTimes(1);
  view.unmount();
});

test('retained loader context from the previous app is not evaluated under a new owner', async () => {
  function Checked() {const ctx=useTogglyContext(); ctx.isEnabled('On'); return <Capture/>;}
  const oldSnapshot={...snapshot,appKey:'one',environment:'Test'};
  const view=render(<TogglyProvider config={config} serverContext={oldSnapshot}><Checked/></TogglyProvider>);
  await flush(); bodies.length=0;
  (fetch as jest.Mock).mockImplementation(async()=>({ok:true,json:async()=>({On:false})}));
  view.rerender(<TogglyProvider config={{...config,appKey:'two',environment:'New'}} serverContext={oldSnapshot}><Checked/></TogglyProvider>);
  expect(current.flags.On).not.toBe(true);
  await act(async()=>{});
  expect(current.flags.On).toBe(false);
  view.unmount();
});

test('entity-gated checks retain the effective variant before aggregate negation',async()=>{
  const flags={Entity:{requirement:'all',rules:[{property:'Tier',op:'eq',value:'pro',type:'string'}]}};
  const view=render(<TogglyProvider config={config} serverContext={{...snapshot,flags}}><Capture/></TogglyProvider>);
  expect(current.isEnabled('Entity')).toBe(false);
  expect(current.isEnabled('Entity',false,{kind:'Account',key:'sensitive',attributes:{Tier:'pro'}})).toBe(true);
  expect(current.evaluateGate(['Entity','Skipped'],'all',true,{kind:'Account',attributes:{Tier:'basic'}})).toBe(true);
  await flush();expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{Entity:{disabled:[2],enabled:[1]}}}]);view.unmount();
});

test('StrictMode double render counts actual leaves without duplicating effect replay',async()=>{
  function Checked(){const ctx=useTogglyContext();ctx.isEnabled('On');return <Capture/>;}
  const view=render(<StrictMode><TogglyProvider config={config} serverContext={snapshot}><Checked/></TogglyProvider></StrictMode>);
  await flush();expect(bodies.map(x=>x.body)).toEqual([{k:'one',e:'Test',f:{On:{enabled:[2]}}}]);view.unmount();
});

test('delayed initialization cannot replace a newer owner or retain timers after teardown',async()=>{
  jest.useFakeTimers();
  let release!:(value:unknown)=>void;
  (fetch as jest.Mock).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const view=render(<TogglyProvider config={config}><Capture/></TogglyProvider>);
  view.rerender(<TogglyProvider config={{...config,appKey:'two'}} serverContext={{...snapshot,flags:{On:false}}}><Capture/></TogglyProvider>);
  await act(async()=>{release({ok:true,json:async()=>({On:true})});});
  expect(current.flags.On).toBe(false);
  view.unmount();await act(async()=>{jest.runAllTicks();});
  expect(jest.getTimerCount()).toBe(0);expect(bodies).toEqual([]);jest.useRealTimers();
});
