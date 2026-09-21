import { Toggly } from '../lib/toggly';
import { StorageKeys } from '../lib/models';
import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types';

function flagsCacheKeyForContext(
  appKey: string,
  environment: string,
  identity: string,
): string {
  return StorageKeys.flagsCacheKey(
    appKey,
    environment,
    `v3:evaluated:${evaluationContextCacheKey({ identity })}`,
  );
}

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234'),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('maxCacheKeys LRU', () => {
  const appKey = 'lru-app';
  const environment = 'Production';

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Toggly.cancelRefreshInterval();
    mockFetch.mockReset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
  });

  afterEach(() => {
    Toggly.cancelRefreshInterval();
    jest.useRealTimers();
  });

  async function initWithMaxCacheKeys(maxCacheKeys: number | null | undefined) {
    mockFetch.mockRejectedValue(new Error('Network error'));
    await Toggly.init({
      appKey,
      environment,
      featureFlagsRefreshInterval: 0,
      maxCacheKeys,
    });
  }

  function writeFlagsForIdentity(identity: string, flags: { [key: string]: boolean }) {
    Toggly.identity = identity;
    (Toggly as any)._inMemoryFlags = null;
    (Toggly as any)._hasLoadedFlags = false;
    Toggly.cacheFeatureFlags(flags);
  }

  it('evicts oldest flags key by lastAccessed when maxCacheKeys is exceeded', async () => {
    await initWithMaxCacheKeys(2);

    writeFlagsForIdentity('user-a', { A: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    writeFlagsForIdentity('user-b', { B: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    writeFlagsForIdentity('user-c', { C: true });

    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))).toBeNull();
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))!)).toEqual({
      B: true,
    });
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))!)).toEqual({
      C: true,
    });
  });

  it('reading a key bumps lastAccessed so it survives eviction', async () => {
    await initWithMaxCacheKeys(2);

    writeFlagsForIdentity('user-a', { A: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    writeFlagsForIdentity('user-b', { B: true });

    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    Toggly.identity = 'user-a';
    (Toggly as any)._inMemoryFlags = null;
    (Toggly as any)._hasLoadedFlags = false;
    expect(Toggly.featureFlagsValue).toEqual({ A: true });

    jest.setSystemTime(new Date('2026-07-11T12:00:03.000Z'));
    writeFlagsForIdentity('user-c', { C: true });

    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))!)).toEqual({
      A: true,
    });
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).toBeNull();
    expect(JSON.parse(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))!)).toEqual({
      C: true,
    });
  });

  it('keeps same-identity flags and variants when maxCacheKeys is 1', async () => {
    await initWithMaxCacheKeys(1);

    Toggly.identity = 'user-a';
    (Toggly as any)._inMemoryFlags = null;
    Toggly.cacheVariants({ A: { enabled: true, variant: 'control' } } as any);
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    Toggly.cacheFeatureFlags({ A: true });

    const flagsKey = flagsCacheKeyForContext(appKey, environment, 'user-a');
    const variantsKey = StorageKeys.variantsCacheKey(
      appKey,
      environment,
      evaluationContextCacheKey({ identity: 'user-a' }),
    );
    expect(localStorage.getItem(flagsKey)).not.toBeNull();
    expect(localStorage.getItem(variantsKey)).not.toBeNull();
  });

  it('does not evict when maxCacheKeys is omitted (unlimited)', async () => {
    await initWithMaxCacheKeys(undefined);

    writeFlagsForIdentity('user-a', { A: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    writeFlagsForIdentity('user-b', { B: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    writeFlagsForIdentity('user-c', { C: true });

    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-a'))).not.toBeNull();
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-b'))).not.toBeNull();
    expect(localStorage.getItem(flagsCacheKeyForContext(appKey, environment, 'user-c'))).not.toBeNull();
    expect(localStorage.getItem(StorageKeys.cacheLruKey)).toBeNull();
  });

  it('does not remove identity or revision keys during LRU eviction', async () => {
    await initWithMaxCacheKeys(2);

    localStorage.setItem(StorageKeys.identityKey, 'keep-me');
    const revisionKey = StorageKeys.definitionsRevisionCacheKey(appKey, environment);
    localStorage.setItem(revisionKey, '"etag-1"');

    writeFlagsForIdentity('user-a', { A: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    writeFlagsForIdentity('user-b', { B: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    writeFlagsForIdentity('user-c', { C: true });

    expect(localStorage.getItem(StorageKeys.identityKey)).toBe('user-c');
    expect(localStorage.getItem(revisionKey)).toBe('"etag-1"');
  });

  it.each([[false, 1], [true, 1], [true, 3]])('evicts scoped revisions with bodies without additional cache slots (variants=%s, limit=%s)', async (variants, limit) => {
    const enableVariants = variants as boolean;
    const maxCacheKeys = limit as number;
    const revisionKey = (identity: string) => StorageKeys.definitionsRevisionCacheKey(appKey, environment,
      `v2:${enableVariants ? 'variants' : 'evaluated'}:${evaluationContextCacheKey({ identity })}`);
    mockFetch.mockImplementation(async () => ({
      ok: true, status: 200,
      headers: { get: (key: string) => key.toLowerCase() === 'etag' ? 'revision-' + Toggly.identity : null },
      json: async () => enableVariants ? { A: { enabled: true, variant: 'blue' } } : { A: true },
    }));
    await Toggly.init({ appKey, environment, identity: 'user-a', enableVariants, maxCacheKeys,
      featureFlagsRefreshInterval: 0, enableLiveUpdates: false, enableTelemetry: false });
    for (const identity of ['user-b', 'user-c']) {
      jest.setSystemTime(Date.now() + 1000);
      await Toggly.setContext({ identity });
    }
    expect(localStorage.getItem(revisionKey('user-a'))).toBeNull();
    expect(localStorage.getItem(revisionKey('user-b'))).toBeNull();
    expect(localStorage.getItem(revisionKey('user-c'))).toBe('revision-user-c');
    expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))).toHaveLength(1);
    expect(Object.keys(JSON.parse(localStorage.getItem(StorageKeys.cacheLruKey)!).entries)).toHaveLength(enableVariants ? Math.max(2, maxCacheKeys) : 1);
    if (enableVariants) expect(Toggly.getVariant('A')?.name).toBe('blue');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null },
      json: async () => enableVariants ? { A: { enabled: false } } : { A: false } });
    expect(await Toggly.setContext({ identity: 'user-a' })).toEqual({ A: false });
    expect(new Headers(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1]?.headers).has('If-None-Match')).toBe(false);
    expect(Toggly.isFeatureOn('A')).toBe(false);
  });

  it.each([false, true])('does not recreate revision metadata after another bundle evicts live bodies (variants=%s)', async enableVariants => {
    let other: typeof Toggly;
    jest.isolateModules(() => { other = require('../lib/toggly').Toggly; });
    expect(other!).not.toBe(Toggly);
    mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
      const revision = `rev-${new URL(url).searchParams.get('i')}`;
      const notModified = new Headers(init.headers).get('If-None-Match') === revision;
      return { ok: !notModified, status: notModified ? 304 : 200,
        headers: { get: (key: string) => key.toLowerCase() === 'etag' ? revision : null },
        json: async () => enableVariants ? { A: { enabled: true, variant: 'blue', configurationValue: 7 } } : { A: true } };
    });
    const config = { appKey, environment, enableVariants, maxCacheKeys: enableVariants ? 2 : 1,
      featureFlagsRefreshInterval: 0, enableLiveUpdates: false, enableTelemetry: false };
    try {
      await Toggly.init({ ...config, instanceId: 'a' });
      jest.setSystemTime(Date.now() + 1000);
      await other!.init({ ...config, instanceId: 'b' });
      const keysForA = () => Object.keys(localStorage).filter(key => key.endsWith(':i:a'));
      expect(keysForA()).toEqual([]);
      for (let refresh = 0; refresh < 2; refresh++) {
        expect(await Toggly.fetchFeatureFlags()).toEqual({ A: true });
        expect(Toggly.isFeatureOn('A')).toBe(true);
        expect(Toggly.getVariant('A')).toEqual(enableVariants ? { name: 'blue', configurationValue: 7 } : null);
        expect(new Headers(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].headers).get('If-None-Match')).toBe('rev-a');
        expect(keysForA()).toEqual([]);
      }
      expect(Object.keys(localStorage).filter(key => key.startsWith('toggly:revision:'))).toHaveLength(1);
    } finally { other!.cancelRefreshInterval(); }
  });

  it.each([null, '{', '[]'])('requires a readable persisted variant body before renewing a revision (%s)', async damagedBody => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'rev-a' },
      json: async () => ({ A: { enabled: true, variant: 'blue' } }) });
    await Toggly.init({ appKey, environment, instanceId: 'a', enableVariants: true,
      featureFlagsRefreshInterval: 0, enableLiveUpdates: false, enableTelemetry: false });
    const revisionKey = StorageKeys.definitionsRevisionCacheKey(appKey, environment, 'v2:variants:i:a');
    const variantKey = StorageKeys.variantsCacheKey(appKey, environment, 'i:a');
    localStorage.removeItem(revisionKey);
    if (damagedBody === null) localStorage.removeItem(variantKey);
    else localStorage.setItem(variantKey, damagedBody);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 304, headers: { get: () => 'rev-a' } });
    expect(await Toggly.fetchFeatureFlags()).toEqual({ A: true });
    expect(Toggly.getVariant('A')?.name).toBe('blue');
    expect(localStorage.getItem(revisionKey)).toBeNull();
  });

  it('removes cleared flags and variants keys from the LRU index', async () => {
    await initWithMaxCacheKeys(2);

    writeFlagsForIdentity('user-a', { A: true });
    Toggly.cacheVariants({ A: { enabled: true, variant: 'control' } } as any);

    const flagsKey = flagsCacheKeyForContext(appKey, environment, 'user-a');
    const variantsKey = StorageKeys.variantsCacheKey(
      appKey,
      environment,
      evaluationContextCacheKey({ identity: 'user-a' }),
    );

    Toggly.clearFeatureFlagsCache();

    const indexRaw = localStorage.getItem(StorageKeys.cacheLruKey);
    expect(indexRaw).not.toBeNull();
    const index = JSON.parse(indexRaw!);
    expect(index.entries[flagsKey]).toBeUndefined();
    expect(index.entries[variantsKey]).toBeUndefined();
  });
});
