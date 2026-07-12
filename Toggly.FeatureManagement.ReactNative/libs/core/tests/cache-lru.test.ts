import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types';
import { TogglyService } from '../src/services/TogglyService';
import { MemoryStorage } from '../src/services/MemoryStorage';
import type { FeatureFlags } from '../src/models';

const FEATURE_FLAGS_CACHE_PREFIX = '@toggly:featureFlagsCache:';
const CACHE_LRU_KEY = '@toggly:cache-lru';

const mockFetch = global.fetch as jest.Mock;

function okResponse(flags: FeatureFlags) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => flags,
    headers: new Map(),
  };
}

async function findFlagsCacheKey(
  storage: MemoryStorage,
  identity: string,
): Promise<string | undefined> {
  const contextKey = evaluationContextCacheKey({ identity });
  for (const key of storage.keys()) {
    if (!key.startsWith(FEATURE_FLAGS_CACHE_PREFIX)) {
      continue;
    }
    const raw = await storage.get(key);
    if (!raw) {
      continue;
    }
    const parsed = JSON.parse(raw) as { identity?: string };
    if (parsed.identity === contextKey) {
      return key;
    }
  }
  return undefined;
}

describe('maxCacheKeys LRU', () => {
  const appKey = 'lru-app';
  const environment = 'Production';
  let storage: MemoryStorage;
  let service: TogglyService | undefined;

  beforeEach(() => {
    storage = new MemoryStorage();
    mockFetch.mockReset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    service?.dispose();
    service = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function createService(
    maxCacheKeys: number | null | undefined,
    identity?: string,
  ): TogglyService {
    return new TogglyService({
      appKey,
      environment,
      identity,
      maxCacheKeys,
      storage,
      enableLiveUpdates: false,
      refreshInterval: 0,
    });
  }

  async function writeFlagsWithMax(
    maxCacheKeys: number | null | undefined,
    identity: string,
    flags: FeatureFlags,
  ): Promise<TogglyService> {
    mockFetch.mockResolvedValueOnce(okResponse(flags));
    const next = createService(maxCacheKeys, identity);
    await next.init();
    return next;
  }

  it('evicts oldest feature-flag cache key by lastAccessed when maxCacheKeys is exceeded', async () => {
    service = await writeFlagsWithMax(2, 'user-a', { A: true });
    const keyA = await findFlagsCacheKey(storage, 'user-a');
    expect(keyA).toBeDefined();

    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ B: true }));
    await service.setContext({ identity: 'user-b' });
    const keyB = await findFlagsCacheKey(storage, 'user-b');
    expect(keyB).toBeDefined();

    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ C: true }));
    await service.setContext({ identity: 'user-c' });
    const keyC = await findFlagsCacheKey(storage, 'user-c');

    expect(await storage.get(keyA!)).toBeNull();
    expect(JSON.parse((await storage.get(keyB!))!).flags).toBe(JSON.stringify({ B: true }));
    expect(JSON.parse((await storage.get(keyC!))!).flags).toBe(JSON.stringify({ C: true }));
  });

  it('reading a key bumps lastAccessed so it survives eviction', async () => {
    service = await writeFlagsWithMax(2, 'user-a', { A: true });
    const keyA = await findFlagsCacheKey(storage, 'user-a');

    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ B: true }));
    await service.setContext({ identity: 'user-b' });
    const keyB = await findFlagsCacheKey(storage, 'user-b');

    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    service.dispose();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    service = new TogglyService({
      appKey,
      environment,
      identity: 'user-a',
      maxCacheKeys: 2,
      storage,
      enableLiveUpdates: false,
      refreshInterval: 0,
      featureDefaults: {},
    });
    await service.init();

    jest.setSystemTime(new Date('2026-07-11T12:00:03.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ C: true }));
    await service.setContext({ identity: 'user-c' });
    const keyC = await findFlagsCacheKey(storage, 'user-c');

    expect(JSON.parse((await storage.get(keyA!))!).flags).toBe(JSON.stringify({ A: true }));
    expect(await storage.get(keyB!)).toBeNull();
    expect(JSON.parse((await storage.get(keyC!))!).flags).toBe(JSON.stringify({ C: true }));
  });

  it('does not evict when maxCacheKeys is omitted (unlimited)', async () => {
    service = await writeFlagsWithMax(undefined, 'user-a', { A: true });
    const keyA = await findFlagsCacheKey(storage, 'user-a');

    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ B: true }));
    await service.setContext({ identity: 'user-b' });
    const keyB = await findFlagsCacheKey(storage, 'user-b');

    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ C: true }));
    await service.setContext({ identity: 'user-c' });
    const keyC = await findFlagsCacheKey(storage, 'user-c');

    expect(await storage.get(keyA!)).not.toBeNull();
    expect(await storage.get(keyB!)).not.toBeNull();
    expect(await storage.get(keyC!)).not.toBeNull();
    expect(await storage.get(CACHE_LRU_KEY)).toBeNull();
  });

  it('does not track or evict deviceId, etag, or jwks keys', async () => {
    await storage.set('@toggly:deviceId', 'device-keep');
    await storage.set('@toggly:etag', 'etag-keep');
    await storage.set('@toggly:jwks', '{"keys":[]}');

    service = await writeFlagsWithMax(2, 'user-a', { A: true });
    jest.setSystemTime(new Date('2026-07-11T12:00:01.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ B: true }));
    await service.setContext({ identity: 'user-b' });
    jest.setSystemTime(new Date('2026-07-11T12:00:02.000Z'));
    mockFetch.mockResolvedValueOnce(okResponse({ C: true }));
    await service.setContext({ identity: 'user-c' });

    // deviceId / jwks are unrelated to feature-flag cache clears
    expect(await storage.get('@toggly:deviceId')).toBe('device-keep');
    expect(await storage.get('@toggly:jwks')).toBe('{"keys":[]}');

    const index = JSON.parse((await storage.get(CACHE_LRU_KEY))!);
    expect(index.entries['@toggly:deviceId']).toBeUndefined();
    expect(index.entries['@toggly:etag']).toBeUndefined();
    expect(index.entries['@toggly:jwks']).toBeUndefined();
    for (const key of Object.keys(index.entries)) {
      expect(key.startsWith(FEATURE_FLAGS_CACHE_PREFIX)).toBe(true);
    }
  });

  it('removes cleared feature-flag cache keys from the LRU index', async () => {
    service = await writeFlagsWithMax(2, 'user-a', { A: true });
    const keyA = await findFlagsCacheKey(storage, 'user-a');
    expect(keyA).toBeDefined();

    const indexBefore = JSON.parse((await storage.get(CACHE_LRU_KEY))!);
    expect(indexBefore.entries[keyA!]).toBeDefined();

    await service.clearCache();

    const indexAfter = JSON.parse((await storage.get(CACHE_LRU_KEY))!);
    expect(indexAfter.entries[keyA!]).toBeUndefined();
    expect(await storage.get(keyA!)).toBeNull();
  });
});
