import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFlags,
  isFeatureEnabled,
  resetFlagsMemoryCache,
  type DefinitionCacheRecorder,
} from '../../src/flags';
import type { Env } from '../../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    TOGGLY_API_BASE_URL: 'https://definitions.toggly.io',
    TOGGLY_ENVIRONMENT: 'Production',
    TOGGLY_APP_KEY: 'workerd-app',
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

function makeRecorder(): DefinitionCacheRecorder & { hits: number; misses: number } {
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

describe('flag evaluation (workerd)', () => {
  beforeEach(() => {
    resetFlagsMemoryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetFlagsMemoryCache();
  });

  it('evaluates evaluated-signed payloads inside workerd with fetch mocked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ defs: { FeatureOn: true, FeatureOff: false } }));
    vi.stubGlobal('fetch', fetchMock);
    const recorder = makeRecorder();

    const flags = await getFlags(makeEnv(), {}, null, recorder);
    expect(flags).toEqual({ FeatureOn: true, FeatureOff: false });
    expect(await isFeatureEnabled('FeatureOn', makeEnv(), {}, null, recorder)).toBe(
      true,
    );
    expect(await isFeatureEnabled('FeatureOff', makeEnv(), {}, null, recorder)).toBe(
      false,
    );
    expect(await isFeatureEnabled('Missing', makeEnv(), {}, null, recorder)).toBe(
      false,
    );
    // Initial getFlags is a miss; each subsequent isFeatureEnabled reuses memory TTL as a hit.
    expect(recorder.misses).toBe(1);
    expect(recorder.hits).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]![0]);
    expect(requestUrl).toContain(
      '/evaluated-signed/workerd-app/Production',
    );
  });

  it('accepts bare flag maps from the definitions API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ BareFlag: true })),
    );
    await expect(getFlags(makeEnv(), {}, null)).resolves.toEqual({ BareFlag: true });
  });
});
