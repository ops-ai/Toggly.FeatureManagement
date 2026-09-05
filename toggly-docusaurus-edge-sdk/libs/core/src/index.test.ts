import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTogglyClient, type Flags } from './index';

describe('createTogglyClient', () => {
  const mockFetch = vi.fn();
  const defaultConfig = {
    baseURI: 'https://client.toggly.io',
    environment: 'Production',
    appKey: 'test-app',
    fetch: mockFetch,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return flags from API on first call', async () => {
    const mockFlags: Flags = {
      Test1: true,
      Test2: false,
      Test3: false,
      on: true,
      off1: false,
      off2: false,
      on2: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFlags,
    } as Response);

    const client = createTogglyClient(defaultConfig);
    const flags = await client.getFlags();

    expect(flags).toEqual(mockFlags);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://client.toggly.io/test-app/evaluated-signed',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      })
    );
  });

  it('reads text() and falls back on invalid envelope when verifySignatures is true', async () => {
    const invalidBody = JSON.stringify({ defs: { Test1: true } });
    const text = vi.fn().mockResolvedValue(invalidBody);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text,
      json: async () => JSON.parse(invalidBody),
    } as unknown as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      verifySignatures: true,
      flagDefaults: { Test1: false },
    });
    const flags = await client.getFlags();

    expect(text).toHaveBeenCalled();
    expect(flags).toEqual({ Test1: false });
  });

  it('should use cached flags if within refresh interval', async () => {
    const mockFlags: Flags = {
      Test1: true,
      Test2: false,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockFlags,
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      featureFlagsRefreshInterval: 30_000,
    });

    // First call - should fetch
    const flags1 = await client.getFlags();
    expect(flags1).toEqual(mockFlags);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call within interval - should use cache
    const flags2 = await client.getFlags();
    expect(flags2).toEqual(mockFlags);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, cache used
  });

  it('should refresh flags when cache expires', async () => {
    const mockFlags1: Flags = { Test1: true };
    const mockFlags2: Flags = { Test1: false, Test2: true };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockFlags1,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockFlags2,
      } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      featureFlagsRefreshInterval: 30_000,
    });

    // First call
    const flags1 = await client.getFlags();
    expect(flags1).toEqual(mockFlags1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time past refresh interval
    vi.advanceTimersByTime(30_001);

    // Second call after interval - should fetch again
    const flags2 = await client.getFlags();
    expect(flags2).toEqual(mockFlags2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should get a single flag with default value', async () => {
    const mockFlags: Flags = {
      Test1: true,
      Test2: false,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockFlags,
    } as Response);

    const client = createTogglyClient(defaultConfig);

    // Existing flag
    const flag1 = await client.getFlag('Test1');
    expect(flag1).toBe(true);

    // Existing flag (false)
    const flag2 = await client.getFlag('Test2');
    expect(flag2).toBe(false);

    // Non-existent flag with default
    const flag3 = await client.getFlag('NonExistent', true);
    expect(flag3).toBe(true);

    // Non-existent flag without default (should default to false)
    const flag4 = await client.getFlag('NonExistent');
    expect(flag4).toBe(false);
  });

  it('should use flagDefaults when flag is not found', async () => {
    const mockFlags: Flags = {
      Test1: true,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockFlags,
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      flagDefaults: {
        DefaultFlag: true,
        AnotherDefault: false,
      },
    });

    // Flag from API
    const flag1 = await client.getFlag('Test1');
    expect(flag1).toBe(true);

    // Flag from flagDefaults
    const flag2 = await client.getFlag('DefaultFlag');
    expect(flag2).toBe(true);

    // Flag from flagDefaults (false)
    const flag3 = await client.getFlag('AnotherDefault');
    expect(flag3).toBe(false);
  });

  it('should manually refresh flags', async () => {
    const mockFlags1: Flags = { Test1: true };
    const mockFlags2: Flags = { Test1: false, Test2: true };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockFlags1,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockFlags2,
      } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      featureFlagsRefreshInterval: 30_000,
    });

    // Initial fetch
    await client.getFlags();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Manual refresh
    await client.refreshFlags();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Next getFlags should use the refreshed cache
    const flags = await client.getFlags();
    expect(flags).toEqual(mockFlags2);
    expect(mockFetch).toHaveBeenCalledTimes(2); // Still 2, cache used
  });

  it('should use injected fetch implementation', async () => {
    const customFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Test1: true }),
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      fetch: customFetch,
    });

    await client.getFlags();

    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fall back to cached flags on API error', async () => {
    const mockFlags: Flags = { Test1: true, Test2: false };

    // First call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFlags,
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      featureFlagsRefreshInterval: 30_000,
    });
    await client.getFlags();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time past refresh interval to force a new fetch
    vi.advanceTimersByTime(30_001);

    // Second call fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should return cached flags
    const flags = await client.getFlags();
    expect(flags).toEqual(mockFlags);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should fall back to flagDefaults on API error when no cache', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const client = createTogglyClient({
      ...defaultConfig,
      flagDefaults: {
        FallbackFlag: true,
      },
    });

    const flags = await client.getFlags();
    expect(flags).toEqual({ FallbackFlag: true });
  });

  it('should use flagDefaults when appKey is not provided', async () => {
    const client = createTogglyClient({
      baseURI: 'https://client.toggly.io',
      environment: 'Production',
      // No appKey
      flagDefaults: {
        DefaultFlag1: true,
        DefaultFlag2: false,
      },
    });

    const flags = await client.getFlags();
    expect(flags).toEqual({
      DefaultFlag1: true,
      DefaultFlag2: false,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should include identity parameter in URL when provided', async () => {
    const mockFlags: Flags = { Test1: true };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockFlags,
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      identity: 'user-123',
    });

    await client.getFlags();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://client.toggly.io/test-app/evaluated-signed?u=user-123',
      expect.any(Object)
    );
  });

  it('should handle baseURI with trailing slash', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Test1: true }),
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      baseURI: 'https://client.toggly.io/',
    });

    await client.getFlags();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://client.toggly.io/test-app/evaluated-signed',
      expect.any(Object)
    );
  });

  it('should use default values when config is empty', async () => {
    const client = createTogglyClient({
      fetch: mockFetch,
      appKey: 'test-app',
    });

    // Should use default baseURI and environment
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ Test1: true }),
    } as Response);

    await client.getFlags();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://definitions.toggly.io/test-app/evaluated-signed',
      expect.any(Object)
    );
  });

  it('should throw error if fetch is not available', () => {
    // Mock a scenario where fetch is undefined
    const originalFetch = globalThis.fetch;
    try {
      // @ts-expect-error - intentionally removing fetch for test
      globalThis.fetch = undefined;

      expect(() => {
        createTogglyClient({
          baseURI: 'https://client.toggly.io',
          environment: 'Production',
          appKey: 'test-app',
          // No fetch provided
        });
      }).toThrow('fetch is not available. Please provide a fetch implementation via config.fetch');
    } finally {
      // Restore fetch
      globalThis.fetch = originalFetch;
    }
  });

  it('should respect connectTimeout', async () => {
    // Mock a fetch that simulates timeout via AbortSignal
    const slowFetch = vi.fn().mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        const signal = options?.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
        // Use fake timers to simulate slow response
        setTimeout(() => {
          if (!signal?.aborted) {
            resolve({
              ok: true,
              json: async () => ({}),
            } as Response);
          }
        }, 10000);
      });
    });

    const client = createTogglyClient({
      ...defaultConfig,
      fetch: slowFetch,
      connectTimeout: 100, // 100ms timeout
      flagDefaults: {},
    });

    // Start the request
    const flagsPromise = client.getFlags();

    // Advance timers to trigger timeout
    vi.advanceTimersByTime(101);

    // Should abort after timeout and fall back to flagDefaults
    const flags = await flagsPromise;
    expect(flags).toEqual({});
    expect(slowFetch).toHaveBeenCalled();
  });

  it('does not treat HTTP 200 error envelopes as feature definitions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ error: 'invalid key' }),
      json: async () => ({ error: 'invalid key' }),
    } as Response);

    const client = createTogglyClient({
      ...defaultConfig,
      flagDefaults: { Safe: true },
    });

    const flags = await client.getFlags();
    expect(flags).toEqual({ Safe: true });
  });
});
