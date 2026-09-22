import { Toggly } from '../lib/toggly';
import { StorageKeys } from '../lib/models';

const config = { appKey: 'oracle-app', identity: '', groups: [], claims: {}, instanceId: 'token/A', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
const variantDefs = { Flag: { enabled: true, variant: 'blue', configurationValue: 42 }, Off: { enabled: false, variant: 'red' } };
const ok = (defs: object, revision: string) => ({ ok: true, status: 200, headers: { get: () => revision }, json: async () => ({ defs }) } as unknown as Response);
let packets: any[];
let calls: Array<{ variants: boolean; revision?: string }>;
let active: typeof Toggly;

beforeEach(() => {
  Toggly.cancelRefreshInterval();
  localStorage.clear();
  active = Toggly; packets = []; calls = [];
  global.fetch = jest.fn(async (url, options) => {
    if (String(url).includes('/telemetry')) {
      packets.push(JSON.parse(options!.body as string));
      return { status: 202 } as Response;
    }
    const variants = String(url).includes('evaluated-variants');
    const revision = (options!.headers as Record<string, string>)['If-None-Match'];
    calls.push({ variants, revision });
    const current = variants ? 'variants-A' : 'boolean-B';
    if (revision === current) return { status: 304, headers: { get: () => null } } as unknown as Response;
    return ok(variants ? variantDefs : { Flag: false }, current);
  });
});
afterEach(() => { active.cancelRefreshInterval(); jest.restoreAllMocks(); });

test.each([false, true])('mode A -> B -> A uses its own body on persisted 304 (first variants %s)', async enableVariants => {
  await active.init({ ...config, enableTelemetry: false, enableVariants });
  expect(active.isFeatureOn('Flag')).toBe(enableVariants);
  await active.init({ ...config, enableTelemetry: false, enableVariants: !enableVariants });
  expect(active.isFeatureOn('Flag')).toBe(!enableVariants);
  await active.init({ ...config, enableTelemetry: false, enableVariants });
  expect(calls).toEqual([
    { variants: enableVariants, revision: undefined },
    { variants: !enableVariants, revision: undefined },
    { variants: enableVariants, revision: enableVariants ? 'variants-A' : 'boolean-B' },
  ]);
  expect(active.featureFlagsValue).toEqual(enableVariants ? { Flag: true, Off: false } : { Flag: false });
  expect(active.getVariant('Flag')).toEqual(enableVariants ? { name: 'blue', configurationValue: 42 } : null);
});

test('evicted mode bodies cannot supply an orphan conditional revision', async () => {
  await active.init({ ...config, enableTelemetry: false, enableVariants: true, maxCacheKeys: 1 });
  await active.init({ ...config, enableTelemetry: false, enableVariants: false, maxCacheKeys: 1 });
  await active.init({ ...config, enableTelemetry: false, enableVariants: true, maxCacheKeys: 1 });
  expect(calls[2].revision).toBeUndefined();
  expect(active.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 42 });
  const index = JSON.parse(localStorage.getItem(StorageKeys.cacheLruKey)!);
  // The active flags + variants pair remains protected under the existing LRU policy.
  expect(Object.keys(index.entries)).toHaveLength(2);
});

test.each(['disabled', 'missing', 'throws', 'read-write-failure'])('retains assigned checks, disabled fallback and context clearing when storage is %s', async storage => {
  if (storage === 'missing' || storage === 'throws') {
    jest.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      if (storage === 'throws') throw new Error('denied');
      return undefined as unknown as Storage;
    });
    jest.isolateModules(() => { active = require('../lib/toggly').Toggly; });
  } else if (storage === 'read-write-failure') {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  }
  await active.init({ ...config, enableVariants: true, persistCache: storage !== 'disabled' });
  expect(active.variantsValue).toEqual(variantDefs);
  expect(active.isFeatureOn('Flag')).toBe(true);
  expect(active.isFeatureOn('Off')).toBe(false);
  active.setLocalGates([{ id: 'blocked', flagKeys: ['Flag'], isEnabled: () => false }]);
  expect(active.isFeatureOn('Flag')).toBe(false);
  await active.flushTelemetry();
  expect(packets).toEqual([{ k: 'oracle-app', e: 'Production', i: 'token/A', f: { Flag: { blue: [1], disabled: [1] }, Off: { disabled: [1] } } }]);
  active.setLocalGates([]);
  expect(active.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 42 });
  await active.flushTelemetry();
  active.instanceId = 'token/B';
  expect(active.variantsValue).toBeNull();
  expect(active.getVariant('Flag')).toBeNull();
  await active.flushTelemetry();
  expect(packets[2]).toEqual({ k: 'oracle-app', e: 'Production', i: 'token/B', f: { Flag: { disabled: [1] } } });
});

test('memory-only reentrant evaluation keeps old assignment and clears it for new calls', async () => {
  await active.init({ ...config, enableVariants: true, persistCache: false });
  active.setLocalGates([{ id: 'rotate', flagKeys: ['Flag'], isEnabled: () => { active.instanceId = 'token/B'; return true; } }]);
  expect(active.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 42 });
  active.setLocalGates([]);
  expect(active.getVariant('Flag')).toBeNull();
  await active.flushTelemetry();
  expect(packets).toEqual([
    { k: 'oracle-app', e: 'Production', i: 'token/A', f: { Flag: { blue: [1] } } },
    { k: 'oracle-app', e: 'Production', i: 'token/B', f: { Flag: { disabled: [1] } } },
  ]);
});

test('memory-only variants reset on explicit cache clear and reinitialization', async () => {
  await active.init({ ...config, enableVariants: true, persistCache: false, enableTelemetry: false });
  active.clearFeatureFlagsCache();
  expect(active.variantsValue).toBeNull();
  await active.refresh();
  expect(calls[1].revision).toBeUndefined();
  expect(active.getVariant('Flag')?.name).toBe('blue');
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await active.init({ ...config, appKey: 'new-app', enableVariants: true, persistCache: false, enableTelemetry: false });
  expect(active.variantsValue).toBeNull();
  expect(active.getVariant('Flag')).toBeNull();
});

test('memory-only same-context refresh retains its body and assignment on 304', async () => {
  await active.init({ ...config, enableVariants: true, persistCache: false, enableTelemetry: false });
  await active.setContext({ groups: [] });
  expect(calls[1].revision).toBe('variants-A');
  expect(active.featureFlagsValue).toEqual({ Flag: true, Off: false });
  expect(active.getVariant('Flag')).toEqual({ name: 'blue', configurationValue: 42 });
});
