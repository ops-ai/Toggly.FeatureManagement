import { Toggly } from '../lib/toggly';
import { FeatureRequirement } from '../lib/models';
import { gunzipSync } from 'zlib';

type Request = { url: string; init?: RequestInit };
const requests: Request[] = [];
let definitions: Record<string, unknown> = {};

const telemetry = Toggly as typeof Toggly & {
  flushTelemetry(): Promise<void>;
  recordUsage(featureKey: string, variant?: string): void;
  recordView(featureKey: string, variant?: string): void;
  incrementCounter(metricKey: string, value?: number): void;
  setGauge(metricKey: string, value: number): void;
};
const flush = (): Promise<void> => telemetry.flushTelemetry();

beforeEach(() => {
  localStorage.clear();
  Toggly.cancelRefreshInterval();
  Toggly.setLocalGates([]);
  requests.length = 0;
  definitions = {};
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const address = String(url);
    requests.push({ url: address, init });
    if (address.includes('/api/frontend/telemetry')) {
      return { status: 202, ok: true } as Response;
    }
    return { status: 200, ok: true, json: async () => ({ defs: definitions }) } as Response;
  });
});

afterEach(() => {
  Toggly.cancelRefreshInterval();
});

async function initialize(config: Record<string, unknown> = {}): Promise<void> {
  await Toggly.init({
    appKey: 'public-key',
    identity: '',
    environment: 'Staging',
    enableLiveUpdates: false,
    featureFlagsRefreshInterval: 0,
    persistCache: false,
    ...config,
  });
}

function telemetryBodies(): Array<Record<string, any>> {
  return requests
    .filter(request => request.url.includes('/api/frontend/telemetry'))
    .map(request => {
      const body = request.init!.body!;
      const json = typeof body === 'string' ? body : gunzipSync(Buffer.from(body as ArrayBuffer)).toString();
      return JSON.parse(json);
    });
}

async function waitForTelemetryCount(count: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (telemetryBodies().length < count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(telemetryBodies()).toHaveLength(count);
}

test('counts only evaluated leaves with effective values before aggregate negation', async () => {
  definitions = { On: true, Off: false, Skipped: true };
  await initialize();
  Toggly.featureFlagsValue;
  await Toggly.refresh();

  expect(Toggly.evaluateFeatureGate(['On', 'Skipped'], FeatureRequirement.any, true)).toBe(false);
  expect(Toggly.evaluateFeatureGate(['Off', 'Skipped'], FeatureRequirement.all)).toBe(false);
  expect(Toggly.isFeatureOff('On')).toBe(false);
  await flush();

  expect(telemetryBodies()).toEqual([{ k: 'public-key', e: 'Staging', f: {
    On: { enabled: [2] },
    Off: { disabled: [1] },
  } }]);
});

test('records local and entity results with owner identity and no entity attributes', async () => {
  definitions = {
    Local: true,
    Entity: { requirement: 'all', rules: [{ property: 'Color', op: 'eq', value: 'brown' }] },
  };
  await initialize({
    identity: 'private-user',
    localGates: [{ id: 'local', flagKeys: ['Local'], isEnabled: () => false }],
  });

  expect(Toggly.isFeatureOn('Local')).toBe(false);
  expect(Toggly.isFeatureOn('Entity', {
    kind: 'Order', key: 'secret-order', attributes: { Color: 'brown' },
  })).toBe(true);
  await flush();

  expect(telemetryBodies()).toEqual([{ k: 'public-key', e: 'Staging', u: 'private-user', f: {
    Local: { disabled: [1] }, Entity: { enabled: [1] },
  } }]);
});

test('variant value delegation records one assigned variant check and a disabled fallback', async () => {
  definitions = { Sale: { enabled: true, variant: 'Treatment', configurationValue: 42 }, Off: { enabled: false } };
  await initialize({ enableVariants: true, persistCache: true });

  expect(Toggly.getVariantValue('Sale')).toBe(42);
  expect(Toggly.getVariant('Off')).toBeNull();
  await flush();

  expect(telemetryBodies()).toEqual([{ k: 'public-key', e: 'Staging', f: {
    Sale: { Treatment: [1] }, Off: { disabled: [1] },
  } }]);
});

test('explicit events and metrics flush without causing feature checks', async () => {
  definitions = { Sale: true };
  await initialize();

  telemetry.recordUsage('Sale');
  telemetry.recordView('Sale', 'Treatment');
  telemetry.incrementCounter('checkout', 2);
  telemetry.setGauge('cart_size', 3);
  await flush();

  expect(telemetryBodies()).toEqual([{ k: 'public-key', e: 'Staging',
    f: { Sale: { enabled: [0, 1], Treatment: [0, 0, 1] } },
    m: { checkout: 2, cart_size: 3 },
  }]);
});

test('opt-out and keyless initialization stay silent and allow feature evaluation', async () => {
  definitions = { On: true };
  const add = jest.spyOn(window, 'addEventListener');
  try {
    await initialize({ enableTelemetry: false });
    expect(Toggly.isFeatureOn('On')).toBe(true);
    telemetry.recordUsage('On');
    await flush();

    await Toggly.init({ flagDefaults: { On: true }, featureFlagsRefreshInterval: 0 });
    expect(Toggly.isFeatureOn('On')).toBe(true);
    telemetry.incrementCounter('checkout');
    await flush();

    expect(telemetryBodies()).toEqual([]);
    expect(add.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(0);
  } finally {
    add.mockRestore();
  }
});

test('reinitialization flushes old events with their old application and detaches their lifecycle', async () => {
  definitions = { On: true };
  await initialize({ appKey: 'first-key' });
  telemetry.recordUsage('On');
  await initialize({ appKey: 'second-key', environment: 'Production' });
  telemetry.recordView('On');
  await flush();
  await waitForTelemetryCount(2);

  expect(telemetryBodies().sort((left, right) => left.k.localeCompare(right.k))).toEqual([
    { k: 'first-key', e: 'Staging', f: { On: { enabled: [0, 1] } } },
    { k: 'second-key', e: 'Production', f: { On: { enabled: [0, 0, 1] } } },
  ]);
});

test('pagehide flushes with keepalive and synchronous teardown removes lifecycle listeners', async () => {
  definitions = { On: true };
  const remove = jest.spyOn(window, 'removeEventListener');
  try {
    await initialize();
    telemetry.recordUsage('On');
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    const telemetryRequest = requests.find(request => request.url.includes('/api/frontend/telemetry'));
    expect(telemetryRequest?.init).toEqual(expect.objectContaining({
      method: 'POST', credentials: 'omit', keepalive: true,
    }));
    expect(telemetryRequest?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    Toggly.cancelRefreshInterval();
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
  } finally {
    remove.mockRestore();
  }
});

test('invalid telemetry endpoint does not block flag evaluation and reports a bounded code', async () => {
  definitions = { On: true };
  const errors: string[] = [];
  await initialize({
    metricsBaseUrl: 'https://metrics.toggly.io/?token=private',
    onError: (message: string) => errors.push(message),
  });
  expect(Toggly.isFeatureOn('On')).toBe(true);
  telemetry.recordUsage('On');
  await flush();

  expect(errors).toEqual(['Frontend telemetry: invalid-option']);
  expect(telemetryBodies()).toEqual([]);
});

test('late initialization cannot overwrite replacement flags or report them under the new application', async () => {
  let resolveOld!: (response: Response) => void;
  const transport = global.fetch;
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/old-key/')) return new Promise<Response>(resolve => { resolveOld = resolve; });
    return transport(url, init);
  });
  const old = Toggly.init({appKey:'old-key',enableLiveUpdates:false,persistCache:false,featureFlagsRefreshInterval:0});
  await Promise.resolve(); await Promise.resolve();
  definitions = { Switch: false };
  await initialize({appKey:'new-key'});
  resolveOld({status:200,ok:true,json:async()=>({defs:{Switch:true}})} as Response);
  await old;
  expect(Toggly.isFeatureOn('Switch')).toBe(false);
  await flush();
  expect(telemetryBodies()).toEqual([{k:'new-key',e:'Staging',f:{Switch:{disabled:[1]}}}]);
});

test('late response after synchronous teardown cannot restore flags or background work', async () => {
  let resolveOld!: (response: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
  const old = Toggly.init({appKey:'old-key',enableLiveUpdates:false,persistCache:false,featureFlagsRefreshInterval:0});
  await Promise.resolve();await Promise.resolve();
  Toggly.cancelRefreshInterval();
  resolveOld({status:200,ok:true,json:async()=>({defs:{Late:true}})} as Response);
  await old;
  expect(Toggly.featureFlagsValue).toEqual({});
  Toggly.recordUsage('Late');await flush();
  expect(telemetryBodies()).toEqual([]);
});

test('retained websocket callbacks cannot schedule refresh or mutate a replacement owner', async () => {
  const OriginalSocket = global.WebSocket;
  const sockets: Array<any> = [];
  class Socket {
    onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() { sockets.push(this); } close() {}
  }
  global.WebSocket = Socket as any;
  try {
    await initialize({enableLiveUpdates:true});
    const old = {...sockets[0]};
    await initialize({appKey:'replacement',enableLiveUpdates:true});
    jest.useFakeTimers();
    old.onopen();old.onmessage({data:'flags-updated'});old.onclose();
    expect(Toggly._wsConnected).toBe(false);
    expect(Toggly._ws).toBe(sockets[1]);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    Toggly.cancelRefreshInterval();jest.useRealTimers();global.WebSocket=OriginalSocket;
  }
});

test('retained evaluation and identify continuations cannot record events under a replacement owner', async () => {
  definitions = {On:true};await initialize({appKey:'old-hooks'});
  let finishEvaluation!: () => void, finishIdentify!: () => void;
  Toggly.addHook({getMetadata:()=>({name:'delayed-owner-hook'}),
    beforeEvaluation:()=>new Promise<void>(resolve=>{finishEvaluation=resolve}),
    afterEvaluation:()=>{Toggly.recordUsage('StaleEvaluation')},
    beforeIdentify:()=>new Promise<void>(resolve=>{finishIdentify=resolve}),
    afterIdentify:()=>{Toggly.recordUsage('StaleIdentify')},
  });
  try {
    Toggly.isFeatureOn('On');Toggly.identity='old-identity';
    const finishOldEvaluation=finishEvaluation, finishOldIdentify=finishIdentify;
    await initialize({appKey:'new-hooks'});
    finishOldEvaluation();finishOldIdentify();
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    await flush();await waitForTelemetryCount(1);
    expect(telemetryBodies()).toEqual([{k:'old-hooks',e:'Staging',f:{On:{enabled:[1]}}}]);
  } finally {Toggly.removeHook('delayed-owner-hook')}
});

test('restarting definition refresh preserves the same telemetry owner and accepted queue', async () => {
  definitions={On:true};await initialize();
  Toggly.recordUsage('On');Toggly.startRefreshInterval();Toggly.recordUsage('On');await flush();
  expect(telemetryBodies()).toEqual([{k:'public-key',e:'Staging',f:{On:{enabled:[0,2]}}}]);
});

test.each([false,true])('a delayed body cannot overwrite replacement state (variants=%s)', async enableVariants => {
  let finishBody!: (body: unknown) => void;
  const transport=global.fetch;
  global.fetch=jest.fn((url:RequestInfo|URL,init?:RequestInit)=>String(url).includes('/slow-body/')
    ? Promise.resolve({status:200,ok:true,json:()=>new Promise(resolve=>{finishBody=resolve})} as Response)
    : transport(url,init));
  const old=Toggly.init({appKey:'slow-body',enableVariants,enableLiveUpdates:false,featureFlagsRefreshInterval:0,persistCache:true});
  for(let i=0;i<10&&!finishBody;i++)await Promise.resolve();
  expect(finishBody).toBeDefined();
  definitions=enableVariants?{Switch:{enabled:false,variant:'New'}}:{Switch:false};
  await initialize({appKey:'new-body',enableVariants,persistCache:true});
  finishBody({defs:enableVariants?{Switch:{enabled:true,variant:'Old'}}:{Switch:true}});await old;
  expect(Toggly.isFeatureOn('Switch')).toBe(false);await flush();
  expect(telemetryBodies()).toEqual([{k:'new-body',e:'Staging',f:{Switch:{disabled:[1]}}}]);
});
