import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFlags,
  isFeatureEnabled,
  resetFlagsMemoryCache,
  type DefinitionCacheRecorder,
} from '../src/flags';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    TOGGLY_API_BASE_URL: 'https://definitions.toggly.io',
    TOGGLY_ENVIRONMENT: 'Production',
    TOGGLY_APP_KEY: 'my-app',
    ORIGIN_BASE_URL: 'https://docs.example.com',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMemoryCache(): Cache {
  const store = new Map<string, Response>();
  return {
    async match(request: RequestInfo | URL): Promise<Response | undefined> {
      const key = typeof request === 'string' ? request : new Request(request).url;
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(request: RequestInfo | URL, response: Response): Promise<void> {
      const key = typeof request === 'string' ? request : new Request(request).url;
      store.set(key, response.clone());
    },
    async delete(): Promise<boolean> {
      return false;
    },
  } as Cache;
}

function makeRecorder(): DefinitionCacheRecorder & {
  hits: number;
  misses: number;
} {
  const state = { hits: 0, misses: 0 };
  return {
    get hits() {
      return state.hits;
    },
    get misses() {
      return state.misses;
    },
    recordDefinitionCacheHit() {
      state.hits += 1;
    },
    recordDefinitionCacheMiss() {
      state.misses += 1;
    },
  };
}

describe('getFlags definition cache accounting', () => {
  beforeEach(() => {
    resetFlagsMemoryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetFlagsMemoryCache();
  });

  it('counts in-memory TTL still valid as a hit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ defs: { FeatureA: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const recorder = makeRecorder();

    await getFlags(makeEnv(), {}, null, recorder);
    expect(recorder.misses).toBe(1);
    expect(recorder.hits).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await getFlags(makeEnv(), {}, null, recorder);
    expect(recorder.hits).toBe(1);
    expect(recorder.misses).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts Cache API serve as a hit when memory TTL is cold', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ defs: { FeatureA: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = makeMemoryCache();
    const recorder = makeRecorder();

    await getFlags(makeEnv(), {}, cache, recorder);
    expect(recorder.misses).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Expire isolate memory TTL so the next call consults Cache API.
    vi.advanceTimersByTime(31_000);
    await getFlags(makeEnv(), {}, cache, recorder);
    expect(recorder.hits).toBe(1);
    expect(recorder.misses).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('counts successful network apply as a miss', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ FeatureB: false }));
    vi.stubGlobal('fetch', fetchMock);
    const recorder = makeRecorder();

    const flags = await getFlags(makeEnv(), {}, null, recorder);
    expect(flags).toEqual({ FeatureB: false });
    expect(recorder.misses).toBe(1);
    expect(recorder.hits).toBe(0);
  });

  it('counts network error with last-good as a hit', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ defs: { FeatureA: true } }))
      .mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch', fetchMock);
    const recorder = makeRecorder();

    await getFlags(makeEnv(), {}, null, recorder);
    expect(recorder.misses).toBe(1);

    vi.advanceTimersByTime(31_000);
    const flags = await getFlags(makeEnv(), {}, null, recorder);
    expect(flags).toEqual({ FeatureA: true });
    expect(recorder.hits).toBe(1);
    expect(recorder.misses).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not count network error when there is no last-good', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const recorder = makeRecorder();

    const flags = await getFlags(makeEnv(), {}, null, recorder);
    expect(flags).toEqual({});
    expect(recorder.hits).toBe(0);
    expect(recorder.misses).toBe(0);
  });

  it('does not increment beyond one outcome per getFlags / isFeatureEnabled refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ FeatureA: true, FeatureB: false })));
    vi.stubGlobal('fetch', fetchMock);
    const recorder = makeRecorder();

    // First refresh: miss. Second within memory TTL: hit. Not one count per flag key.
    await isFeatureEnabled('FeatureA', makeEnv(), {}, null, recorder);
    await isFeatureEnabled('FeatureB', makeEnv(), {}, null, recorder);

    expect(recorder.misses).toBe(1);
    expect(recorder.hits).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves cache.put fire-and-forget (rejection does not fail the request)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ defs: { FeatureA: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const recorder = makeRecorder();
    const cache = {
      async match(): Promise<Response | undefined> {
        return undefined;
      },
      put(): Promise<void> {
        return Promise.reject(new Error('cache unavailable'));
      },
      async delete(): Promise<boolean> {
        return false;
      },
    } as Cache;

    await expect(getFlags(makeEnv(), {}, cache, recorder)).resolves.toEqual({
      FeatureA: true,
    });
    expect(recorder.misses).toBe(1);
    expect(recorder.hits).toBe(0);
  });
});
