import {createBrowserTelemetry} from '../../src/client/telemetry';
const config={appKey:'app',environment:'Test',metricsBaseUrl:'https://collector.test'};
let bodies:any[]=[];
beforeEach(()=>{bodies=[]; (fetch as jest.Mock).mockImplementation(async(_url,init)=>{bodies.push(JSON.parse(init.body));return {status:202};});});

test('pre-commit aggregation preserves sums, last gauge and metric kind, then clears staging',async()=>{
  const diagnostic=jest.fn(()=>{throw Error('host diagnostic');});
  const owner=createBrowserTelemetry({...config,onError:diagnostic});
  owner.api.incrementCounter('orders',2);owner.api.incrementCounter('orders',3);
  owner.api.setGauge('orders',4);owner.api.setGauge('cart',1);owner.api.setGauge('cart',2);
  owner.recordCheck('On',true);owner.recordCheck('On',true);owner.api.recordUsage('On');owner.api.recordView('On','control');
  owner.api.recordUsage('bad','bad.variant');owner.api.incrementCounter('bad',Infinity);
  expect(fetch).not.toHaveBeenCalled();
  owner.activate();owner.activate();await owner.api.flushTelemetry();
  expect(bodies).toEqual([{k:'app',e:'Test',f:{On:{enabled:[2,1],control:[0,0,1]}},m:{orders:5,cart:2}}]);
  owner.api.recordUsage('On');await owner.api.flushTelemetry();
  expect(bodies[1]).toEqual({k:'app',e:'Test',f:{On:{enabled:[0,1]}}});owner.dispose();
});

test('pre-commit byte, replay-work and variant budgets reject incoming data without evicting accepted events',async()=>{
  const diagnostic=jest.fn();const owner=createBrowserTelemetry({...config,onError:diagnostic});
  owner.api.recordUsage('Kept');
  owner.api.recordUsage('x'.repeat(50000));
  for(let i=0;i<20;i++) owner.api.recordView('Variants','v'+i);
  for(let i=0;i<2050;i++) owner.recordCheck('Count',true);
  owner.activate();await owner.api.flushTelemetry();
  expect(bodies[0].f.Kept.enabled).toEqual([0,1]);
  expect(Object.keys(bodies[0].f.Variants)).toHaveLength(16);
  expect(bodies[0].f.Count.enabled[0]).toBe(1983);
  expect(Object.keys(bodies[0].f)).toHaveLength(3);
  expect(diagnostic.mock.calls.length).toBeLessThanOrEqual(10);
  owner.dispose();
});

test('pre-commit byte reservation and disposal bound large unique names',async()=>{
  const owner=createBrowserTelemetry(config);
  for(let i=0;i<100;i++)owner.api.recordUsage('x'.repeat(4000)+i);
  owner.activate();await owner.api.flushTelemetry();
  const keys=bodies.flatMap(body=>Object.keys(body.f));
  expect(keys.length).toBeGreaterThan(1);expect(keys.length).toBeLessThan(100);
  owner.dispose();
  const abandoned=createBrowserTelemetry(config);abandoned.api.recordUsage('Discarded');abandoned.dispose();abandoned.activate();
  await abandoned.api.flushTelemetry();
  expect(bodies.every(body=>!body.f.Discarded)).toBe(true);
});


test('captures attribution across pre-commit and active context transitions with one shared budget', async () => {
  const owner = createBrowserTelemetry({...config, identity: 'alice'});
  const captured = owner.captureCheck();
  owner.api.setGauge('cart', 1);
  owner.setContext({identity:'bob',instanceId:'token-b'});
  owner.api.setGauge('cart', 2);
  captured('Old', true);
  owner.activate();
  owner.api.recordUsage('New');
  const activeCapture = owner.captureCheck();
  owner.setContext({identity:'carol'});
  activeCapture('Prior', false);
  owner.api.recordView('Current');
  await owner.api.flushTelemetry();
  expect(bodies).toEqual([
    {k:'app',e:'Test',u:'alice',m:{cart:1}},
    {k:'app',e:'Test',i:'token-b',m:{cart:2}},
    {k:'app',e:'Test',u:'alice',f:{Old:{enabled:[1]}}},
    {k:'app',e:'Test',i:'token-b',f:{New:{enabled:[0,1]}}},
    {k:'app',e:'Test',i:'token-b',f:{Prior:{disabled:[1]}}},
    {k:'app',e:'Test',u:'carol',f:{Current:{enabled:[0,0,1]}}},
  ]);
  owner.dispose();
});


test('pre-commit gauge ordering survives returning to a previous attribution', async () => {
  const owner = createBrowserTelemetry({...config, identity:'alice'});
  owner.api.setGauge('cart',1);
  owner.setContext({identity:'bob'}); owner.api.setGauge('cart',2);
  owner.setContext({identity:'alice'}); owner.api.setGauge('cart',3);
  owner.activate(); await owner.api.flushTelemetry();
  expect(bodies.map(body => [body.u, body.m.cart])).toEqual([['alice',1],['bob',2],['alice',3]]);
  owner.dispose();
});
