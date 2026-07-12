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
    evaluationContextCacheKey({ identity }),
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
