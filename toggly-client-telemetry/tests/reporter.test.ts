import { createTelemetryReporter } from '../src/index';
const contract = require('../../tests/frontend-telemetry/contract.json');
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup(options: any = {}) {
  const calls: { url: string; init: any; time: number }[] = [];
  const fetch = jest.fn(async (url: string, init: any) => { calls.push({ url, init, time: Date.now() }); return { status: 202 }; });
  const reporter = createTelemetryReporter({ appKey: 'test-app', fetch, ...options, _runtime: { gzip: async () => undefined, ...options._runtime } });
  return { reporter, fetch, calls, bodies: () => fetch.mock.calls.map(c => JSON.parse(c[1].body)) };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
for (const scenario of contract.scenarios) {
  test(`shared contract: ${scenario.name}`, async () => {
    const { reporter, bodies } = setup(scenario.options);
    for (const [method, ...args] of scenario.events) (reporter as any)[method](...args);
    await reporter.flush();
    expect(bodies()).toEqual(scenario.envelopes);
    reporter.dispose();
  });
}
test('normalizes only metrics base path and excludes context/auth from the request', async () => {
  const { reporter, calls } = setup({ metricsBaseUrl: 'https://collector.test/base///', identity: 'user-123', headers: { Authorization: 'secret' } });
  reporter.recordCheck('flag', 'enabled'); await reporter.flush({ keepalive: true });
  expect(calls[0].url).toBe('https://collector.test/base/api/frontend/telemetry');
  expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true, headers: { 'Content-Type': 'application/json' } });
  expect(Object.keys(calls[0].init.headers)).toEqual(['Content-Type']);
  expect(JSON.parse(calls[0].init.body)).toEqual({ k: 'test-app', e: 'Production', u: 'user-123', f: { flag: { enabled: [1] } } });
  reporter.dispose();
});
test('disabled reporters have no scheduled work, even on disposal', async () => {
  for (const options of [{ appKey: '' }, { enableTelemetry: false }]) {
    const { reporter, calls } = setup(options); reporter.recordUsage('flag'); reporter.dispose(); await reporter.flush();
    expect(calls).toHaveLength(0); expect(jest.getTimerCount()).toBe(0);
  }
});
test('invalid intervals fall back to 45 seconds and jitter each schedule', async () => {
  const random = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1);
  const { reporter, calls } = setup({ telemetryFlushIntervalMs: 1, _runtime: { random } });
  reporter.recordCheck('flag', 'enabled');
  await jest.advanceTimersByTimeAsync(35999); expect(calls).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(1); expect(calls).toHaveLength(1);
  reporter.recordUsage('flag'); await jest.advanceTimersByTimeAsync(53999); expect(calls).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1); expect(calls).toHaveLength(2); reporter.dispose();
});
test('concurrent flushes keep one inflight request and preserve new gauge order', async () => {
  const { reporter, fetch, bodies } = setup(); let release!: (value: any) => void;
  fetch.mockImplementationOnce(() => new Promise(r => { release = r; }) as any);
  reporter.setGauge('cart', 1); const first = reporter.flush(); await tick();
  reporter.setGauge('cart', 2); const second = reporter.flush(); await tick(); expect(fetch).toHaveBeenCalledTimes(1);
  release({ status: 202 }); await Promise.all([first, second]);
  expect(bodies()[bodies().length - 1].m.cart).toBe(2); expect(fetch).toHaveBeenCalledTimes(2); reporter.dispose();
});
for (const scenario of contract.transportScenarios) {
  test(`shared transport: ${scenario.name}`, async () => {
    const attempts: number[] = [];
    const { reporter } = setup({ fetch: async () => {
      const index = attempts.length; attempts.push(Date.now());
      if (scenario.failure === 'network') throw new Error('secret');
      if (scenario.failure === 'timeout') return new Promise(() => {});
      return { status: scenario.statuses[index], headers: { get: () => scenario.retryAfter ?? null } };
    } });
    reporter.incrementCounter('orders'); const done = reporter.flush();
    await jest.advanceTimersByTimeAsync(310000); await done;
    expect(attempts).toEqual(scenario.attemptTimesMs); reporter.dispose();
  });
}
for (const status of contract.policy.dropStatuses) {
  test(`does not replay status ${status}`, async () => {
    const { reporter, fetch } = setup(); fetch.mockResolvedValue({ status });
    reporter.recordUsage('flag'); await reporter.flush(); await jest.advanceTimersByTimeAsync(310000);
    expect(fetch).toHaveBeenCalledTimes(1); reporter.dispose();
  });
}
test('splits envelopes by UTF-8 bytes, preserving accepted events', async () => {
  const { reporter, bodies } = setup();
  for (let i = 0; i < 100; i++) reporter.recordUsage('🌍'.repeat(250) + i);
  await reporter.flush(); const payloads = bodies(); expect(payloads.length).toBeGreaterThan(1);
  expect(payloads.every(b => Buffer.byteLength(JSON.stringify(b)) <= 49152)).toBe(true);
  expect(payloads.reduce((n, b) => n + Object.keys(b.f).length, 0)).toBe(100); reporter.dispose();
});
test('rejects oversized individual entries and more than 16 variants without evicting accepted data', async () => {
  const { reporter, bodies } = setup();
  reporter.recordUsage('x'.repeat(49152));
  for (let i = 0; i < 17; i++) reporter.recordCheck('flag', 'v' + i);
  await reporter.flush(); expect(Object.keys(bodies()[0].f)).toEqual(['flag']); expect(Object.keys(bodies()[0].f.flag)).toHaveLength(16); reporter.dispose();
});
test('caps buffered entries across an inflight snapshot', async () => {
  let release!: (value: any) => void; const bodies: any[] = [];
  const { reporter } = setup({ fetch: async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); if (bodies.length === 1) await new Promise(r => { release = r; }); return { status: 202 }; } });
  for (let i = 0; i < 2000; i++) reporter.incrementCounter('m' + i);
  const first = reporter.flush(); await tick(); reporter.incrementCounter('overflow');
  release({ status: 202 }); await first; await reporter.flush();
  const keys = bodies.flatMap(b => Object.keys(b.m)); expect(keys).toHaveLength(2000); expect(keys).not.toContain('overflow'); reporter.dispose();
});
test('caps total buffered bytes during stalled transport with bounded payload-free diagnostics', async () => {
  const diagnostics: any[] = []; const bodies: any[] = []; let release!: (value: any) => void;
  const { reporter } = setup({ onDiagnostic: (d: any) => { diagnostics.push(d); throw new Error('callback'); }, fetch: async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); if (bodies.length === 1) await new Promise(r => { release = r; }); return { status: 202 }; } });
  reporter.recordUsage('first'); const first = reporter.flush(); await tick();
  for (let i = 0; i < 1000; i++) reporter.recordUsage('x'.repeat(1000) + i);
  release({ status: 202 }); await first; await reporter.flush();
  expect(bodies.reduce((n, b) => n + Buffer.byteLength(JSON.stringify(b)), 0)).toBeLessThanOrEqual(262144);
  expect(diagnostics.length).toBeGreaterThan(0); expect(diagnostics.length).toBeLessThanOrEqual(10);
  expect(JSON.stringify(diagnostics)).not.toMatch(/test-app|xxxxx/); reporter.dispose();
});
test('blocks counter/gauge changes while the old kind is inflight, then permits a new window', async () => {
  const sent: any[] = []; let release!: (value: any) => void;
  const { reporter } = setup({ fetch: async (_u: string, i: any) => { sent.push(JSON.parse(i.body)); if (sent.length === 1) await new Promise(r => { release = r; }); return { status: 202 }; } });
  reporter.incrementCounter('value'); const done = reporter.flush(); await tick(); reporter.setGauge('value', 9); release({ status: 202 }); await done; await reporter.flush();
  expect(sent).toHaveLength(1); reporter.setGauge('value', 7); await reporter.flush(); expect(sent[1].m.value).toBe(7); reporter.dispose();
});
test('compression failure falls back before sending, ambiguous transport never retries plain', async () => {
  const { reporter, calls } = setup({ _runtime: { gzip: async () => { throw new Error('compression'); } } });
  reporter.recordUsage('flag'); await reporter.flush(); expect(typeof calls[0].init.body).toBe('string'); reporter.dispose();
  const compressed = new Uint8Array([31,139]).buffer; const fetch = jest.fn().mockRejectedValue(new Error('network'));
  const second = setup({ fetch, _runtime: { gzip: async () => compressed } }); second.reporter.recordUsage('flag'); await second.reporter.flush();
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].headers['Content-Encoding']).toBe('gzip'); second.reporter.dispose();
});
test('exit flush bypasses compression and disposal cancels retries and finalizes newer data once', async () => {
  const gzip = jest.fn(); const { reporter, calls, fetch } = setup({ _runtime: { gzip } });
  fetch.mockResolvedValueOnce({ status: 503 }); reporter.setGauge('cart', 1); const done = reporter.flush({ keepalive: true }); await tick();
  reporter.setGauge('cart', 2); reporter.dispose(); reporter.dispose(); await tick(); await done;
  expect(gzip).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls.map(c => JSON.parse(c[1].body).m.cart)).toEqual([1,2]);
  expect(calls.every(c => c.init.keepalive === true)).toBe(true); expect(jest.getTimerCount()).toBe(0);
});
test('timeout aborts a hanging request and a hanging compressor cannot delay disposal', async () => {
  let signal: AbortSignal | undefined;
  const { reporter } = setup({ fetch: async (_u: string, i: any) => { signal = i.signal; return new Promise(() => {}); } });
  reporter.recordUsage('flag'); const done = reporter.flush(); await tick(); await jest.advanceTimersByTimeAsync(5000); await done; expect(signal?.aborted).toBe(true); reporter.dispose();
  const second = setup({ _runtime: { gzip: () => new Promise(() => {}) } }); second.reporter.recordUsage('flag'); const flushing = second.reporter.flush(); await tick(); second.reporter.dispose(); await jest.advanceTimersByTimeAsync(5000); await flushing; expect(jest.getTimerCount()).toBe(0);
});
test('bounds repeated maximum increments by virtual chunks rather than enormous envelope loops', async () => {
  const { reporter, bodies } = setup();
  for (let i = 0; i < 2010; i++) reporter.incrementCounter('orders', 1000000);
  reporter.incrementCounter('too-large', Number.MAX_SAFE_INTEGER);
  await reporter.flush(); expect(bodies()).toHaveLength(2000); expect(bodies().every(b => b.m.orders === 1000000 && !('too-large' in b.m))).toBe(true); reporter.dispose();
});
test('flush after an empty concurrent flush still sends the data present at its call', async () => {
  const { reporter, bodies } = setup(); const empty = reporter.flush(); reporter.recordUsage('flag'); await reporter.flush(); await empty;
  expect(bodies()).toEqual([{ k: 'test-app', e: 'Production', f: { flag: { enabled: [0,1] } } }]); reporter.dispose();
});
test('invalid endpoint configuration disables transport without throwing', async () => {
  for (const metricsBaseUrl of ['/relative', 'ftp://invalid.test', 'https://user:pass@invalid.test', 'https://invalid.test/?identity=secret']) {
    const diagnostic = jest.fn(); const { reporter, calls } = setup({ metricsBaseUrl, onDiagnostic: diagnostic }); reporter.recordUsage('flag'); await reporter.flush(); reporter.dispose();
    expect(calls).toHaveLength(0); expect(diagnostic).toHaveBeenCalledWith('invalid-option'); expect(jest.getTimerCount()).toBe(0);
  }
});
test('HTTP-date Retry-After preserves old gauge ordering across concurrent flushes', async () => {
  const sent: { time: number; body: any }[] = [];
  const { reporter } = setup({ fetch: async (_u: string, i: any) => { sent.push({ time: Date.now(), body: JSON.parse(i.body) }); return { status: sent.length === 1 ? 429 : 202, headers: { get: () => 'Thu, 01 Jan 1970 00:02:00 GMT' } }; } });
  reporter.setGauge('cart', 1); const done = reporter.flush(); await tick(); reporter.setGauge('cart', 2); const next = reporter.flush();
  await jest.advanceTimersByTimeAsync(119999); expect(sent).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1); await Promise.all([done, next]);
  expect(sent.map(x => x.body.m.cart)).toEqual([1,1,2]); expect(sent.map(x => x.time)).toEqual([0,120000,120000]); reporter.dispose();
});
test('two instances and reinitialization never relabel accepted context', async () => {
  const old = setup({ appKey: 'old', environment: 'Staging' }); const current = setup({ appKey: 'new' });
  old.reporter.recordUsage('flag'); old.reporter.dispose(); current.reporter.recordUsage('flag'); await Promise.all([old.reporter.flush(), current.reporter.flush()]);
  expect(old.bodies()[0]).toMatchObject({ k: 'old', e: 'Staging' }); expect(current.bodies()[0]).toMatchObject({ k: 'new', e: 'Production' }); current.reporter.dispose();
});
test('rejects nonfinite and fractional deltas, permits finite fractional gauges and zero', async () => {
  const { reporter, bodies } = setup();
  for (const value of [NaN, Infinity, -Infinity, -1, 1000001]) { reporter.setGauge('invalid', value); reporter.incrementCounter('invalid', value); }
  reporter.incrementCounter('fraction', 0.25); reporter.setGauge('fraction', 0.25); reporter.setGauge('zero', 0);
  reporter.recordCheck('é界', '__proto__'); await reporter.flush();
  expect(bodies()).toEqual([{ k:'test-app', e:'Production', f: { 'é界': { ['__proto__']:[1] } }, m:{fraction:0.25,zero:0} }]); reporter.dispose();
});
test('native gzip round-trips real platform output and unsupported platforms fall back', async () => {
  jest.useRealTimers();
  const calls: any[] = [];
  const reporter = createTelemetryReporter({ appKey: 'native-gzip', fetch: async (_u, init) => { calls.push(init); return { status: 202 }; } });
  try {
    reporter.recordUsage('flag'); await reporter.flush();
    expect(calls[0].headers['Content-Encoding']).toBe('gzip');
    const { gunzipSync } = require('node:zlib');
    expect(JSON.parse(gunzipSync(Buffer.from(calls[0].body)).toString())).toEqual({ k:'native-gzip',e:'Production',f:{flag:{enabled:[0,1]}} });
  } finally { reporter.dispose(); }
  const original = globalThis.CompressionStream;
  try {
    (globalThis as any).CompressionStream = undefined;
    const plain = createTelemetryReporter({ appKey:'plain', fetch:async (_u, init) => { calls.push(init); return { status:202 }; } });
    plain.recordUsage('flag'); await plain.flush(); plain.dispose(); expect(typeof calls[1].body).toBe('string');
  } finally { globalThis.CompressionStream = original; }
});
test('missing fetch and unreadable retry headers never reject flush', async () => {
  const original = globalThis.fetch;
  try {
    (globalThis as any).fetch = undefined;
    const r = createTelemetryReporter({ appKey:'no-fetch', _runtime:{gzip:async () => undefined} }); r.recordUsage('flag'); await expect(r.flush()).resolves.toBeUndefined(); r.dispose();
  } finally { globalThis.fetch = original; }
  const fetch = jest.fn().mockResolvedValueOnce({ status:503, headers:{get:() => {throw new Error('not exposed');}} }).mockResolvedValue({status:202});
  const { reporter } = setup({fetch}); reporter.recordUsage('flag'); const done=reporter.flush(); await jest.advanceTimersByTimeAsync(30000); await done; expect(fetch).toHaveBeenCalledTimes(2); reporter.dispose();
});
for (const scenario of contract.endpointScenarios) {
  test(`shared endpoint: ${scenario.name}`, async () => {
    const diagnostics: string[] = [];
    const { reporter, calls } = setup({ metricsBaseUrl: scenario.metricsBaseUrl, onDiagnostic: (d: string) => diagnostics.push(d) });
    reporter.recordUsage('flag'); await reporter.flush();
    expect(calls.map(c => c.url)).toEqual(scenario.expectedUrl === null ? [] : [scenario.expectedUrl]);
    if (scenario.expectedUrl === null) {
      expect(diagnostics).toEqual(['invalid-option']);
      expect(jest.getTimerCount()).toBe(0);
    } else expect(diagnostics).toEqual([]);
    reporter.dispose();
  });
}
test('invalid variants have bounded diagnostics without changing valid queued observations', async () => {
  const diagnostics: string[] = [];
  const { reporter, bodies } = setup({ onDiagnostic: (d: string) => diagnostics.push(d) });
  reporter.recordCheck('flag', 'enabled');
  for (let i = 0; i < 100; i++) { reporter.recordCheck('flag', 'trial 1'); reporter.recordUsage('flag', 'café'); reporter.recordView('flag', 'x'.repeat(65)); }
  reporter.recordUsage('flag', 'enabled'); await reporter.flush();
  expect(bodies()).toEqual([{ k:'test-app', e:'Production', f:{flag:{enabled:[1,1]}} }]);
  expect(diagnostics).toEqual(Array(10).fill('invalid-event')); reporter.dispose();
});
