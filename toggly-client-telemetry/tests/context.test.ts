import { createTelemetryReporter } from '../src/index';
const contract = require('../../tests/frontend-telemetry/contract.json');
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function setup(options: any = {}) {
  const requests: any[] = [];
  const reporter = createTelemetryReporter({ appKey: 'test-app', ...options,
    fetch: async (url, init) => { requests.push({url, init}); return options.fetch ? options.fetch(url, init) : {status:202}; },
    _runtime: { gzip: async () => undefined, random: () => 0.5, ...options._runtime },
  });
  return { reporter, requests, bodies: () => requests.map(r => JSON.parse(r.init.body)),
    change: (context: any) => reporter.setContext(context),
    discard: () => reporter.dispose({flush:false}) };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test('shared context transition fixtures are present', () => { expect(contract.contextTransitionScenarios.length).toBeGreaterThan(0); });
for (const scenario of contract.contextTransitionScenarios) {
  test(`shared context transition: ${scenario.name}`, async () => {
    const {reporter, bodies} = setup(scenario.options);
    for (const [method, ...args] of scenario.events) (reporter as any)[method](...args);
    await reporter.flush(); expect(bodies()).toEqual(scenario.envelopes); reporter.dispose();
  });
}
test('routing omission preserves routing, blank key pauses admission, malformed updates are atomic no-ops', async () => {
  const diagnostic = jest.fn(); const {reporter, change, bodies} = setup({environment:'Staging', identity:'alice', onDiagnostic:diagnostic});
  reporter.incrementCounter('first'); change({appKey:'new', environment:'Preview', identity:'bob'}); reporter.incrementCounter('second');
  for (const context of [null, {appKey:42,identity:'bad'}, {environment:[],identity:'bad'}, {identity:{}}, {instanceId:42}]) change(context);
  reporter.incrementCounter('second'); change({appKey:''}); reporter.incrementCounter('dropped');
  change({appKey:'last'}); reporter.incrementCounter('last'); await reporter.flush();
  expect(bodies()).toEqual([
    {k:'test-app',e:'Staging',u:'alice',m:{first:1}}, {k:'new',e:'Preview',u:'bob',m:{second:2}}, {k:'last',e:'Preview',m:{last:1}},
  ]); expect(diagnostic.mock.calls).toEqual(Array(5).fill(['invalid-option'])); reporter.dispose();
});
test('same effective context and many empty transitions retain no historical batches or timers', async () => {
  const {reporter, change, bodies} = setup();
  for(let i=0;i<10000;i++) change({identity:'empty-'+i});
  change({instanceId:'token',identity:'ignored'}); reporter.incrementCounter('orders');
  for(let i=0;i<100;i++) change({instanceId:' token ',identity:'ignored-'+i});
  reporter.incrementCounter('orders'); expect(jest.getTimerCount()).toBe(1);
  await reporter.flush(); expect(bodies()).toEqual([{k:'test-app',e:'Production',i:'token',m:{orders:2}}]); reporter.dispose();
});
test('queued and in-flight gauges preserve context order during a retry and return to the original context', async () => {
  const {reporter, change, bodies, requests} = setup({identity:'alice', fetch:async()=>({status:requests.length===1?429:202})});
  reporter.setGauge('cart',1); const done=reporter.flush(); await tick();
  reporter.setGauge('cart',2); change({identity:'bob'}); reporter.setGauge('cart',3); change({identity:'alice'}); reporter.setGauge('cart',4);
  const next=reporter.flush(); await jest.advanceTimersByTimeAsync(30000); await Promise.all([done,next]);
  expect(bodies().map(b=>[b.u,b.m.cart])).toEqual([['alice',1],['alice',1],['alice',2],['bob',3],['alice',4]]);
  expect(requests[0].init.body).toBe(requests[1].init.body); reporter.dispose();
});
test('all context partitions and retry chunks share the 2000-entry admission budget', async () => {
  const diagnostics:string[]=[]; const {reporter, change, bodies, requests} = setup({onDiagnostic:(d:string)=>diagnostics.push(d),fetch:async()=>({status:requests.length===1?503:202})});
  reporter.incrementCounter('orders',1000000); const done=reporter.flush(); await tick();
  for(let i=1;i<2001;i++){change({identity:'u'+i});reporter.incrementCounter('orders',1000000);}
  const next=reporter.flush(); await jest.advanceTimersByTimeAsync(30000); await Promise.all([done,next]);
  expect(bodies()).toHaveLength(2001); expect(bodies().some(b=>b.u==='u2000')).toBe(false);
  expect(diagnostics).toEqual(['buffer-full']); reporter.dispose();
});
test('all context metadata counts as UTF8 toward the global 256KiB and per-envelope 48KiB bounds', async () => {
  const diagnostics:string[]=[]; const {reporter, change, bodies} = setup({onDiagnostic:(d:string)=>diagnostics.push(d)});
  for(let i=0;i<300;i++){change({identity:'🌍'.repeat(1000)+i});reporter.incrementCounter('orders');}
  change({instanceId:'🌍'.repeat(13000)}); reporter.incrementCounter('oversized');
  await reporter.flush(); const payloads=bodies();
  expect(payloads.length).toBeGreaterThan(50); expect(payloads.length).toBeLessThan(70);
  expect(payloads.reduce((n,b)=>n+Buffer.byteLength(JSON.stringify(b)),0)).toBeLessThanOrEqual(262144);
  expect(payloads.every(b=>Buffer.byteLength(JSON.stringify(b))<=49152&&!b.m.oversized)).toBe(true);
  expect(diagnostics).toEqual(Array(10).fill('buffer-full')); reporter.dispose();
});
test('discard settles hanging transport, aborts it, removes timers, and ignores late retryable completion', async () => {
  let finish!:(v:any)=>void; const {reporter,change,discard,requests}=setup({fetch:()=>new Promise(r=>{finish=r;})});
  reporter.incrementCounter('old'); const done=reporter.flush(); await tick(); change({identity:'new'}); reporter.incrementCounter('new');
  discard(); expect(requests[0].init.signal.aborted).toBe(true); expect(jest.getTimerCount()).toBe(0);
  await done; finish({status:503}); await tick(); await jest.advanceTimersByTimeAsync(310000);
  expect(requests).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
});
test('discard cancels default finalization and late compression cannot send after rapid replacement', async () => {
  const compressors:Array<(v:any)=>void>=[]; const requests:any[]=[];
  for(let i=0;i<30;i++) {
    const owner=setup({fetch:async(_u:any,init:any)=>{requests.push(init);return {status:202};},_runtime:{gzip:()=>new Promise(r=>compressors.push(r))}});
    owner.reporter.incrementCounter('old'); const done=owner.reporter.flush(); await tick();
    owner.reporter.dispose(); owner.discard(); await done; expect(jest.getTimerCount()).toBe(0);
  }
  for(const finish of compressors) finish(new Uint8Array([31,139]).buffer);
  await tick(); expect(requests).toHaveLength(0); expect(jest.getTimerCount()).toBe(0);
});
test('discard cancels retry delay and releases pending work without a final send', async()=>{
  const {reporter,change,discard,requests}=setup({fetch:async()=>({status:503})});
  reporter.incrementCounter('old'); const done=reporter.flush(); await tick(); change({identity:'new'});reporter.incrementCounter('new');
  discard(); await done; await reporter.flush(); await jest.advanceTimersByTimeAsync(310000);
  expect(requests).toHaveLength(1); expect(jest.getTimerCount()).toBe(0);
});
test('default disposal sends at most one final envelope across all contexts and remains synchronous',async()=>{
  const {reporter,change,bodies}=setup();
  for(let i=0;i<5;i++){change({identity:'u'+i});reporter.incrementCounter('orders');}
  expect(reporter.dispose()).toBeUndefined(); await reporter.flush();
  expect(bodies()).toEqual([{k:'test-app',e:'Production',u:'u0',m:{orders:1}}]); expect(jest.getTimerCount()).toBe(0);
});
test('opt-out remains silent across transitions and discarded owners cannot be reactivated',async()=>{
  for(const options of [{enableTelemetry:false},{appKey:''}]) {
    const {reporter,change,discard,requests}=setup(options);change({identity:'alice'});reporter.recordUsage('flag');await reporter.flush();discard();
    change({appKey:'valid'}); reporter.recordUsage('flag'); await reporter.flush();
    expect(requests).toEqual([]); expect(jest.getTimerCount()).toBe(0);
  }
});
test('initially keyless activation schedules once and pausing drains old context then becomes silent',async()=>{
  const {reporter,change,bodies}=setup({appKey:''});expect(jest.getTimerCount()).toBe(0);
  change({appKey:'first',identity:'alice'}); expect(jest.getTimerCount()).toBe(1);reporter.incrementCounter('first');
  change({appKey:''});reporter.incrementCounter('dropped');await reporter.flush();
  expect(bodies()).toEqual([{k:'first',e:'Production',u:'alice',m:{first:1}}]);expect(jest.getTimerCount()).toBe(0);
  change({appKey:'last',environment:'',identity:' '});reporter.incrementCounter('last');await reporter.flush();
  expect(bodies()[1]).toEqual({k:'last',e:'',m:{last:1}});expect(jest.getTimerCount()).toBe(1);reporter.dispose();
});
test('retries reuse the exact compressed bytes without rerunning a compressor across context changes',async()=>{
  let compressed=0;const {reporter,change,requests}=setup({_runtime:{gzip:async()=>new Uint8Array([31,139,++compressed]).buffer},fetch:async()=>({status:requests.length<3?503:202})});
  reporter.incrementCounter('old');const done=reporter.flush();await tick();change({identity:'new'});reporter.incrementCounter('new');const next=reporter.flush();
  await jest.advanceTimersByTimeAsync(90000);await Promise.all([done,next]);
  expect(requests.map(r=>Array.from(new Uint8Array(r.init.body)))).toEqual([[31,139,1],[31,139,1],[31,139,1],[31,139,2]]);reporter.dispose();
});
test('flush after pausing a key waits for its already in-flight old context',async()=>{
  let finish!:(v:any)=>void;const {reporter,change,requests}=setup({fetch:()=>new Promise(r=>{finish=r;})});
  reporter.incrementCounter('old'); const first=reporter.flush();await tick();change({appKey:''});
  let settled=false;const paused=reporter.flush().then(()=>{settled=true;});await tick();expect(settled).toBe(false);
  finish({status:202});await Promise.all([first,paused]);expect(requests).toHaveLength(1);expect(jest.getTimerCount()).toBe(0);reporter.dispose();
});
test('discard aborts a final disposal request that has already started',async()=>{
  const {reporter,discard,requests}=setup({fetch:()=>new Promise(()=>{})});reporter.incrementCounter('final');reporter.dispose();const done=reporter.flush();await tick();
  expect(requests).toHaveLength(1);expect(requests[0].init.keepalive).toBe(true);discard();expect(requests[0].init.signal.aborted).toBe(true);await done;expect(jest.getTimerCount()).toBe(0);
});
test('captured evaluation checks keep their owner context across reentrant changes without restoring old context',async()=>{
  const {reporter,change,bodies}=setup({identity:'alice'});reporter.recordUsage('Before');
  const check=reporter.captureCheck();
  // A host callback changes attribution and admits a gauge and check before returning.
  change({identity:'bob'});reporter.setGauge('cart',2);reporter.recordCheck('Current','enabled');
  check('Evaluated','disabled');reporter.recordView('After');await reporter.flush();
  expect(bodies()).toEqual([
    {k:'test-app',e:'Production',u:'alice',f:{Before:{enabled:[0,1]}}},
    {k:'test-app',e:'Production',u:'bob',m:{cart:2},f:{Current:{enabled:[1]}}},
    {k:'test-app',e:'Production',u:'alice',f:{Evaluated:{disabled:[1]}}},
    {k:'test-app',e:'Production',u:'bob',f:{After:{enabled:[0,0,1]}}},
  ]);reporter.dispose();
});
test('captured check recorders are silent after default or discard disposal and cannot inject into a replacement',async()=>{
  for(const flush of [true,false]) {
    const old=setup({identity:'old'});const check=old.reporter.captureCheck();old.reporter.dispose({flush});
    const current=setup({identity:'current'});check.call(current.reporter,'Old','enabled');current.reporter.recordCheck('Current','enabled');
    await Promise.all([old.reporter.flush(),current.reporter.flush()]);expect(old.requests).toHaveLength(0);
    expect(current.bodies()).toEqual([{k:'test-app',e:'Production',u:'current',f:{Current:{enabled:[1]}}}]);current.discard();
  }
});
test('captured checks share the global entry budget and rejected admission does not disturb accepted contexts',async()=>{
  const diagnostics:string[]=[];const {reporter,change,bodies}=setup({identity:'alice',onDiagnostic:(d:string)=>diagnostics.push(d)});
  const check=reporter.captureCheck();change({identity:'bob'});
  for(let i=0;i<1999;i++)reporter.incrementCounter('orders',1000000);
  check('Admitted','enabled');check('Overflow','enabled');await reporter.flush();
  expect(bodies()).toHaveLength(2000);expect(bodies()[1999]).toEqual({k:'test-app',e:'Production',u:'alice',f:{Admitted:{enabled:[1]}}});
  expect(diagnostics).toEqual(['buffer-full']);reporter.dispose();
});
test('capturing without recording allocates no queued history, validates checks, and preserves keyless silence',async()=>{
  const {reporter,change,bodies}=setup();let check!:(key:string,variant:string)=>void;
  for(let i=0;i<10000;i++){check=reporter.captureCheck();change({identity:'empty-'+i});}
  check('invalid','bad variant');reporter.recordCheck('Current','enabled');await reporter.flush();
  expect(bodies()).toEqual([{k:'test-app',e:'Production',u:'empty-9999',f:{Current:{enabled:[1]}}}]);reporter.dispose();
  const keyless=setup({appKey:''});const silent=keyless.reporter.captureCheck();keyless.change({appKey:'valid'});silent('NoKey','enabled');await keyless.reporter.flush();expect(keyless.requests).toHaveLength(0);keyless.discard();
});
