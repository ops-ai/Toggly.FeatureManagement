import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { TogglyPluginOptions } from '../../types/index.js';
let store: typeof import('../../client/store.js');
let requests: Array<{ url: URL; init?: RequestInit }>;
let envelopes: Array<{ k: string; e: string; i?: string; u?: string; f?: Record<string, Record<string, number[]>> }>;
let respond: (url: URL) => Promise<Response>;
const config: TogglyPluginOptions = { appKey: 'identity', identity: 'alice', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
const response = (flags: Record<string, unknown>, revision = 'a') => new Response(JSON.stringify(flags), { headers: { ETag: revision } });
beforeEach(async () => {
  delete (globalThis as Record<PropertyKey, unknown>)[Symbol.for('@ops-ai/gatsby-feature-flags-toggly/client-store-v1')];
  vi.resetModules(); store = await import('../../client/store.js'); requests = []; envelopes = [];
  localStorage.clear(); respond = async () => response({ F: true });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes('telemetry')) {
      const body = init?.body;
      if (!body) throw new Error('Missing telemetry body');
      envelopes.push(JSON.parse(typeof body === 'string' ? body : gunzipSync(Buffer.from(body as Uint8Array)).toString()));
      return new Response(null, { status: 202 });
    }
    requests.push({ url, init }); return respond(url);
  });
});
afterEach(() => { store.disposeTogglyClient(); vi.restoreAllMocks(); });
it('reuses the reporter across minted token transitions, suppresses client targeting, and revisits without an orphan validator', async () => {
  await store.initTogglyClient({ ...config, instanceId: 'token-a', groups: ['g'], claims: { role: 'admin' } });
  store.recordUsage('A');
  await store.initTogglyClient({ ...config, instanceId: 'token-b' });
  store.recordView('B');
  await store.initTogglyClient({ ...config, instanceId: 'token-a' });
  expect(store.$flag('F').get()).toBe(true);
  await store.refreshFlags();
  await store.flushTelemetry();
  expect(requests.map(r => r.url.searchParams.get('i'))).toEqual(['token-a', 'token-b', 'token-a', 'token-a']);
  expect(requests.every(r => !r.url.searchParams.has('u') && !r.url.searchParams.has('g') && !r.url.searchParams.has('claim.role'))).toBe(true);
  expect(requests.slice(0, 3).map(r => new Headers(r.init?.headers).get('If-None-Match'))).toEqual([null, null, null]);
  expect(new Headers(requests[3].init?.headers).get('If-None-Match')).toBe('a');
  expect(envelopes.map(e => e.i)).toEqual(['token-a', 'token-b', 'token-a']);
  expect(envelopes.every(e => e.u === undefined)).toBe(true);
  expect(localStorage.length).toBe(0);
});
it('captures original flags and attribution before a reentrant local gate changes identity', async () => {
  let transition = false;
  await store.initTogglyClient({ ...config, localGates: [{ id: 'change', flagKeys: ['F'], isEnabled: () => { if (!transition) { transition = true; store.setIdentity('bob'); } return true; } }] });
  expect(store.$gate(['F', 'G'], 'all').get()).toBe(false);
  store.recordUsage('After'); await store.flushTelemetry();
  expect(Object.assign({}, ...envelopes.filter(e => e.u === 'alice').map(e => e.f))).toEqual({ F: { enabled: [1] }, G: { disabled: [1] } });
  expect(envelopes.find(e => e.u === 'bob')?.f).toEqual({ After: { enabled: [0, 1] } });
});
it('does not restore retired flags on failed identity refresh or late response', async () => {
  await store.initTogglyClient(config);
  let resolve!: (r: Response) => void;
  respond = async () => new Promise(r => { resolve = r; });
  const old = store.refreshFlags();
  respond = async () => { throw new Error('offline'); };
  await store.initTogglyClient({ ...config, identity: 'bob', flagDefaults: { F: false } });
  expect(store.$flag('F').get()).toBe(false);
  resolve(response({ F: true }, 'old')); await old;
  expect(store.$flag('F').get()).toBe(false);
  expect(store.$error.get()?.message).toBe('offline');
});
it('ignores and removes legacy persisted validators, while valid live 304 retains entity definitions', async () => {
  localStorage.setItem('toggly:revision:identity:Production', 'orphan');
  const gate = { requirement: 'all', rules: [{ property: 'active', op: 'eq', value: true }] };
  respond = async () => response({ F: gate });
  await store.initTogglyClient(config);
  expect(new Headers(requests[0].init?.headers).has('If-None-Match')).toBe(false);
  respond = async () => new Response(null, { status: 304, headers: { ETag: 'a' } });
  await store.refreshFlags();
  expect(store.$flags.get()).toEqual({ F: gate });
  expect(localStorage.length).toBe(0);
});
it('keeps valid 304 in memory with storage unavailable and never applies invalid-body revisions', async () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('unavailable'); });
  await store.initTogglyClient(config);
  respond = async () => new Response('invalid json', { headers: { ETag: 'bad' } });
  await store.refreshFlags();
  expect(store.$flag('F').get()).toBe(true);
  respond = async () => new Response(null, { status: 304 });
  await store.refreshFlags();
  expect(new Headers(requests.at(-1)?.init?.headers).get('If-None-Match')).toBe('a');
  expect(store.$flag('F').get()).toBe(true);
});
it('preserves targeting without a token and clears identity without changing void setter signatures', async () => {
  await store.initTogglyClient({ ...config, groups: ['staff'], claims: { role: 'admin' } });
  expect(requests[0].url.searchParams.get('u')).toBe('alice');
  expect(requests[0].url.searchParams.get('g')).toBe('staff');
  expect(requests[0].url.searchParams.get('claim.role')).toBe('admin');
  expect(store.clearIdentity()).toBeUndefined();
  expect(requests[1].url.searchParams.has('u')).toBe(false);
  expect(store.setIdentity('bob')).toBeUndefined();
  expect(requests[2].url.searchParams.get('u')).toBe('bob');
  await vi.waitFor(() => expect(store.$isReady.get()).toBe(true));
});
it('ignores an older initialization after a new context completes', async () => {
  let resolve!: (r: Response) => void;
  respond = async () => new Promise(r => { resolve = r; });
  const old = store.initTogglyClient(config);
  respond = async () => response({ F: false }, 'bob');
  await store.initTogglyClient({ ...config, identity: 'bob' });
  expect(store.$isReady.get()).toBe(true);
  expect(store.$flags.get()).toEqual({ F: false });
  resolve(response({ F: true }, 'alice')); await old;
  expect(store.$flags.get()).toEqual({ F: false });
  await store.refreshFlags();
  expect(new Headers(requests.at(-1)?.init?.headers).get('If-None-Match')).toBe('bob');
});
it('shares one admission budget across 2200 context transitions and recovers after flushing', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => { /* Expected bounded-admission diagnostics. */ });
  const started = performance.now();
  for (let i = 0; i < 2200; i++) {
    await store.initTogglyClient({ ...config, identity: `user-${i}` });
    store.recordUsage('F');
  }
  const admitted = performance.now();
  await store.flushTelemetry();
  expect(envelopes).toHaveLength(2000);
  expect(envelopes[0].u).toBe('user-0');
  expect(envelopes.at(-1)?.u).toBe('user-1999');
  expect(envelopes.reduce((bytes, envelope) => bytes + Buffer.byteLength(JSON.stringify(envelope)), 0)).toBeLessThanOrEqual(256 * 1024);
  store.recordUsage('Recovered'); await store.flushTelemetry();
  expect(envelopes.at(-1)).toMatchObject({ u: 'user-2199', f: { Recovered: { enabled: [0, 1] } } });
  console.log('GATSBY_ADMISSION_TIMING', { admissionMs: admitted - started, totalMs: performance.now() - started });
  // Full 2200-transition admission is CPU-bound under hosted coverage; keep a bounded per-case allowance.
}, 15000);
it('captures the complete gate snapshot before an entity mapper changes definitions and context', async () => {
  const { registerContext } = await import('@ops-ai/toggly-hooks-types');
  respond = async () => response({ F: true, G: true });
  await store.initTogglyClient(config);
  registerContext('ReentrantGatsbyEntity', () => {
    store.$flags.set({ F: false, G: false });
    store.setIdentity('bob');
    return { kind: 'ReentrantGatsbyEntity', key: 'entity', attributes: {} };
  });
  expect(store.$gate(['F', 'G'], 'all', false, {}, 'ReentrantGatsbyEntity').get()).toBe(true);
  await store.flushTelemetry();
  expect(Object.assign({}, ...envelopes.filter(e => e.u === 'alice').map(e => e.f))).toEqual({ F: { enabled: [1] }, G: { enabled: [1] } });
  expect(envelopes.some(e => e.u === 'bob')).toBe(false);
});
it('keeps context equivalence deterministic without sorting or mutating caller groups', async () => {
  const groups = ['é', 'a', '😀', '\uE000'];
  const original = [...groups];
  await store.initTogglyClient({ ...config, groups, claims: { z: 'last', a: 'first' } });
  await store.initTogglyClient({ ...config, groups: [...groups].reverse(), claims: { a: 'first', z: 'last' } });
  expect(requests).toHaveLength(1);
  expect(groups).toEqual(original);
  groups.push('added');
  await store.initTogglyClient({ ...config, groups });
  expect(requests).toHaveLength(2);
  expect(requests[1].url.searchParams.getAll('g')).toContain('added');
});

it('uses the same normalized token for definitions, context equivalence and telemetry', async () => {
  await store.initTogglyClient({ ...config, instanceId: '  token  ' });
  store.recordUsage('Minted');
  await store.initTogglyClient({ ...config, instanceId: 'token' });
  expect(requests).toHaveLength(1);
  expect(requests[0].url.searchParams.get('i')).toBe('token');
  await store.initTogglyClient({ ...config, instanceId: '   ' });
  store.recordView('Identified'); await store.flushTelemetry();
  expect(requests[1].url.searchParams.has('i')).toBe(false);
  expect(requests[1].url.searchParams.get('u')).toBe('alice');
  expect(envelopes.map(e => [e.i, e.u])).toEqual([['token', undefined], [undefined, 'alice']]);
});
it('keeps the newest same-context response and validator when an older refresh completes last', async () => {
  const refreshed: boolean[] = [];
  await store.initTogglyClient({ ...config, hooks: [{ getMetadata: () => ({ name: 'observe' }), afterRefresh: flags => { refreshed.push(flags.F); } }] });
  refreshed.length = 0;
  let resolveOld!: (response: Response) => void;
  respond = () => new Promise(resolve => { resolveOld = resolve; });
  const old = store.refreshFlags();
  respond = async () => response({ F: false }, 'newest');
  await store.refreshFlags();
  resolveOld(response({ F: true }, 'stale'));
  await old;
  expect(store.$flags.get()).toEqual({ F: false });
  expect(refreshed).toEqual([false]);
  respond = async () => new Response(null, { status: 304 });
  await store.refreshFlags();
  expect(new Headers(requests.at(-1)?.init?.headers).get('If-None-Match')).toBe('newest');
  expect(store.$flags.get()).toEqual({ F: false });
  await store.flushTelemetry();
  expect(envelopes).toHaveLength(0);
});
it('stops the remaining async hooks after a newer refresh supersedes the held callback', async () => {
  let hold = false;
  let release!: () => void;
  const refreshed: boolean[] = [];
  await store.initTogglyClient({ ...config, hooks: [
    { getMetadata: () => ({ name: 'hold' }), afterRefresh: () => hold ? new Promise<void>(resolve => { release = resolve; }) : undefined },
    { getMetadata: () => ({ name: 'observe' }), afterRefresh: flags => { refreshed.push(flags.F); } },
  ] });
  await Promise.resolve();
  refreshed.length = 0;
  hold = true;
  const old = store.refreshFlags();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  hold = false;
  respond = async () => response({ F: false }, 'newest');
  await store.refreshFlags();
  release(); await old;
  expect(refreshed).toEqual([false]);
  expect(store.$flags.get()).toEqual({ F: false });
});

it('snapshots local callbacks and selected key membership before the first leaf runs', async () => {
  respond = async () => response({ First: true, Later: true, Injected: false });
  const keys = ['First', 'Later'];
  const later = { id: 'later', flagKeys: ['Later'], isEnabled: () => true };
  await store.initTogglyClient({ ...config, localGates: [
    { id: 'first', flagKeys: ['First'], isEnabled: () => {
      later.isEnabled = () => false;
      later.flagKeys.push('First');
      keys[1] = 'Injected';
      return true;
    } }, later,
  ] });
  expect(store.$gate(keys).get()).toBe(true);
  await store.flushTelemetry();
  expect(envelopes[0]?.f).toEqual({ First: { enabled: [1] }, Later: { enabled: [1] } });
  store.setLocalGates([]);
  expect(store.$gate(['First', 'Later'], 'any').get()).toBe(true);
  await store.flushTelemetry();
  expect(envelopes[1]?.f).toEqual({ First: { enabled: [1] } });
});
it.each(['token', '  token  '])('constructs the endpoint pathname and removes all base targeting for %s', async instanceId => {
  await store.initTogglyClient({ ...config, instanceId,
    baseURI: 'https://defs.invalid/base/?u=old&u=older&userId=private&g=a&g=b&claim.plan=paid&claim.team=secret&keep=one&keep=two',
    groups: ['staff'], claims: { role: 'admin' },
  });
  const url = requests[0].url;
  expect(url.pathname).toBe('/base/evaluated-signed/identity/Production');
  expect([...url.searchParams]).toEqual([['keep', 'one'], ['keep', 'two'], ['i', 'token']]);
  expect(store.$flag('F').get()).toBe(true);
});
it('preserves unrelated base query fields and ordinary targeting with a blank token', async () => {
  await store.initTogglyClient({ ...config, instanceId: ' ', baseURI: 'https://defs.invalid/base/?keep=one&keep=two', groups: ['staff'], claims: { role: 'admin' } });
  const url = requests[0].url;
  expect(url.pathname).toBe('/base/evaluated-signed/identity/Production');
  expect(url.searchParams.getAll('keep')).toEqual(['one', 'two']);
  expect(url.searchParams.get('u')).toBe('alice');
  expect(url.searchParams.getAll('g')).toEqual(['staff']);
  expect(url.searchParams.get('claim.role')).toBe('admin');
  expect(url.searchParams.has('i')).toBe(false);
});
