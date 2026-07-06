import { Toggly } from '../lib/toggly';
import {
  FeatureRequirement,
  StorageKeys,
  TogglyInitResponse,
  TogglyLoadFeatureFlagsResponse,
} from '../lib/models';
import type { Hook } from '@ops-ai/toggly-hooks-types';
import { evaluationContextCacheKey } from '@ops-ai/toggly-hooks-types';

const DEFAULT_TEST_IDENTITY = 'mock-uuid-1234';

function flagsCacheKeyForContext(
  appKey: string,
  environment: string,
  identity: string = DEFAULT_TEST_IDENTITY,
): string {
  return StorageKeys.flagsCacheKey(
    appKey,
    environment,
    evaluationContextCacheKey({ identity }),
  );
}

function variantsCacheKeyForContext(
  appKey: string,
  environment: string,
  identity: string = DEFAULT_TEST_IDENTITY,
): string {
  return StorageKeys.variantsCacheKey(
    appKey,
    environment,
    evaluationContextCacheKey({ identity }),
  );
}

// Mock uuid to return predictable values
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234'),
}));

// Mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const fetchInitMatcher = expect.objectContaining({ headers: expect.any(Object) });
function waitForHooks(ms = 100): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Toggly Core', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Toggly.cancelRefreshInterval();
    mockFetch.mockReset();
  });

  afterEach(() => {
    Toggly.cancelRefreshInterval();
  });

  // ───────────────────────────────────────────────
  // Initialization
  // ───────────────────────────────────────────────
  describe('Initialization', () => {
    it('should initialize with flagDefaults when no appKey', async () => {
      const flags = await Toggly.init({
        flagDefaults: { Feature1: true, Feature2: false },
      });

      expect(flags).toEqual({ Feature1: true, Feature2: false });
    });

    it('should not call fetch when no appKey is provided', async () => {
      await Toggly.init({ flagDefaults: { F1: true } });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch flags from API when appKey is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ Feature1: true }),
      });

      const flags = await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(flags).toEqual({ Feature1: true });
    });

    it('should construct correct API URL with appKey and environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'my-app',
        environment: 'Staging',
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('evaluated-signed/my-app/Staging'),
        fetchInitMatcher,
      );
    });

    it('should use custom baseURI', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Staging',
        baseURI: 'https://custom.api.com',
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.api.com/evaluated-signed/key/Staging'),
        fetchInitMatcher,
      );
    });

    it('should default to Production environment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('evaluated-signed/key/Production'),
        fetchInitMatcher,
      );
    });

    it('should generate UUID identity when none exists', async () => {
      await Toggly.init({ flagDefaults: { F1: true } });

      expect(Toggly.identity).toBe('mock-uuid-1234');
    });

    it('should not overwrite existing identity', async () => {
      localStorage.setItem(
        StorageKeys.identityKey,
        'existing-user'
      );

      await Toggly.init({ flagDefaults: { F1: true } });

      expect(Toggly.identity).toBe('existing-user');
    });

    it('should preserve cached flags on init for stale-while-revalidate', async () => {
      localStorage.setItem(
        flagsCacheKeyForContext('test-app-key', 'Production'),
        JSON.stringify({ OldFlag: true })
      );

      await Toggly.init({ appKey: 'test-app-key', flagDefaults: { F1: true } });

      expect(
        localStorage.getItem(flagsCacheKeyForContext('test-app-key', 'Production'))
      ).not.toBeNull();
    });

    it('should register hooks from config', (done) => {
      const hookCalls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'InitHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey) => {
          hookCalls.push(flagKey);
          return { flagKey };
        },
      };

      Toggly.init({
        flagDefaults: { F1: true },
        hooks: [hook],
      }).then(() => {
        Toggly.isFeatureOn('F1');

        setTimeout(() => {
          try {
            expect(hookCalls).toContain('F1');
            Toggly.removeHook('InitHook');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });

    it('should log debug messages when isDebug is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await Toggly.init({
        flagDefaults: { F1: true },
        isDebug: true,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.refresh')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.usedFlagDefaults')
      );

      consoleSpy.mockRestore();
    });

    it('should handle init with empty config', async () => {
      const flags = await Toggly.init({} as any);

      expect(flags).toEqual({});
    });

    it('should handle re-initialization with different config', async () => {
      await Toggly.init({ flagDefaults: { F1: true } });
      expect(Toggly.isFeatureOn('F1')).toBe(true);

      await Toggly.init({ flagDefaults: { F1: false, F2: true } });
      expect(Toggly.isFeatureOn('F1')).toBe(false);
      expect(Toggly.isFeatureOn('F2')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // Refresh Interval (uses fake timers)
  // ───────────────────────────────────────────────
  describe('Refresh Interval', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      Toggly.cancelRefreshInterval();
      jest.useRealTimers();
    });

    it('should start refresh interval when appKey and interval configured', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 30000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(30001);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not start interval when featureFlagsRefreshInterval is 0', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(500000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not start interval without appKey', async () => {
      await Toggly.init({
        flagDefaults: { F1: true },
        featureFlagsRefreshInterval: 5000,
      });

      jest.advanceTimersByTime(50000);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should use default featureFlagsRefreshInterval of 3 minutes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance less than 3 minutes
      jest.advanceTimersByTime(2 * 60 * 1000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past 3 minutes
      jest.advanceTimersByTime(60 * 1000 + 1);
      await Promise.resolve();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should trigger refresh at configured interval', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 10000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(10001);
      await Promise.resolve();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(10001);
      await Promise.resolve();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should stop refreshing after cancelRefreshInterval', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 5000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      Toggly.cancelRefreshInterval();

      jest.advanceTimersByTime(50000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cancel existing interval when starting new one', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 5000,
      });

      // Start a new interval (cancels old one first)
      Toggly.startRefreshInterval();

      jest.advanceTimersByTime(5001);
      await Promise.resolve();

      // Should have: init fetch (1) + one interval tick (1) = 2
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not start interval when calling startRefreshInterval without appKey', async () => {
      await Toggly.init({
        flagDefaults: { F1: true },
      });

      Toggly.startRefreshInterval();

      jest.advanceTimersByTime(500000);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────
  // Feature Loading (fetchFeatureFlags)
  // ───────────────────────────────────────────────
  describe('Feature Loading', () => {
    it('should include identity as query param in fetch URL', async () => {
      localStorage.setItem(
        StorageKeys.identityKey,
        'user-42'
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('?u=user-42');
    });

    it('should include generated UUID identity in fetch URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('?u=mock-uuid-1234');
    });

    it('should cache fetched flags in localStorage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true, F2: false }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      const cached = JSON.parse(
        localStorage.getItem(flagsCacheKeyForContext('test-app-key', 'Production'))!
      );
      expect(cached).toEqual({ F1: true, F2: false });
    });

    it('should fall back to cached flags on network error', async () => {
      // 1. Init with successful fetch (populates cache)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ CachedFlag: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.featureFlagsValue).toEqual({ CachedFlag: true });

      // 2. Refresh with network error - should use cached flags
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const flags = await Toggly.refresh();
      expect(flags).toEqual({ CachedFlag: true });
    });

    it('should fall back to flagDefaults when no cache and network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const flags = await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        flagDefaults: { DefaultFlag: true },
        featureFlagsRefreshInterval: 0,
      });

      expect(flags).toEqual({ DefaultFlag: true });
    });

    it('should handle JSON parse error from API response', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const flags = await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        flagDefaults: { Fallback: true },
        featureFlagsRefreshInterval: 0,
      });

      expect(flags).toEqual({ Fallback: true });
    });

    it('should handle fetch timeout error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Request timed out'));

      const flags = await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        flagDefaults: { TimeoutFallback: true },
        featureFlagsRefreshInterval: 0,
      });

      expect(flags).toEqual({ TimeoutFallback: true });
    });

    it('should log debug message on successful fetch', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        isDebug: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.fetchFeatureFlags')
      );

      consoleSpy.mockRestore();
    });

    it('should log debug message when falling back to cache', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      mockFetch.mockRejectedValueOnce(new Error('fail'));

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        flagDefaults: { F1: true },
        isDebug: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.loadedFromCache')
      );

      consoleSpy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────
  // Storage & Persistence
  // ───────────────────────────────────────────────
  describe('Storage & Persistence', () => {
    it('should return cached flags via featureFlagsValue when appKey is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ ApiFlag: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.featureFlagsValue).toEqual({ ApiFlag: true });
    });

    it('should return flagDefaults when no appKey', async () => {
      await Toggly.init({
        flagDefaults: { LocalFlag: true },
      });

      expect(Toggly.featureFlagsValue).toEqual({ LocalFlag: true });
    });

    it('should return flagDefaults when appKey is set but cache is empty', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        flagDefaults: { DefaultFlag: false },
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.featureFlagsValue).toEqual({ DefaultFlag: false });
    });

    it('should store flags via cacheFeatureFlags', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      Toggly.cacheFeatureFlags({ X: true, Y: false });

      const stored = JSON.parse(
        localStorage.getItem(flagsCacheKeyForContext('test-app-key', 'Production'))!
      );
      expect(stored).toEqual({ X: true, Y: false });
    });

    it('should remove flags cache via clearFeatureFlagsCache', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      localStorage.setItem(
        flagsCacheKeyForContext('test-app-key', 'Production'),
        JSON.stringify({ X: true })
      );

      Toggly.clearFeatureFlagsCache();

      expect(
        localStorage.getItem(flagsCacheKeyForContext('test-app-key', 'Production'))
      ).toBeNull();
    });

    it('should handle null/missing localStorage for featureFlagsValue', async () => {
      await Toggly.init({ flagDefaults: { F1: true } });

      localStorage.removeItem(flagsCacheKeyForContext('test-app-key', 'Production'));

      expect(Toggly.featureFlagsValue).toEqual({ F1: true });
    });
  });

  // ───────────────────────────────────────────────
  // Identity Management
  // ───────────────────────────────────────────────
  describe('Identity Management', () => {
    beforeEach(async () => {
      await Toggly.init({ flagDefaults: { F1: true } });
    });

    it('should read identity from localStorage', () => {
      localStorage.setItem(
        StorageKeys.identityKey,
        'user-42'
      );
      expect(Toggly.identity).toBe('user-42');
    });

    it('should write identity to localStorage', () => {
      Toggly.identity = 'new-user';
      expect(
        localStorage.getItem(StorageKeys.identityKey)
      ).toBe('new-user');
    });

    it('should clear identity from localStorage', () => {
      Toggly.identity = 'temp-user';
      Toggly.clearIdentity();
      expect(
        localStorage.getItem(StorageKeys.identityKey)
      ).toBeNull();
    });

    it('should trigger identity hooks when setting identity', (done) => {
      const hookCalls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'IdSetHook', version: '1.0.0' }),
        beforeIdentify: async (identity) => {
          hookCalls.push(`before:${identity}`);
          return { identity };
        },
        afterIdentify: async (identity) => {
          hookCalls.push(`after:${identity}`);
        },
      };
      Toggly.addHook(hook);

      Toggly.identity = 'user-123';

      setTimeout(() => {
        try {
          expect(hookCalls).toEqual(['before:user-123', 'after:user-123']);
          Toggly.removeHook('IdSetHook');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should trigger hooks when clearing existing identity', (done) => {
      // Set identity first and wait for its async hooks to complete
      Toggly.identity = 'user-to-clear';

      setTimeout(() => {
        const hookCalls: string[] = [];
        const hook: Hook = {
          getMetadata: () => ({ name: 'IdClearHook', version: '1.0.0' }),
          beforeIdentify: async (identity) => {
            hookCalls.push(`before:${identity}`);
            return { identity };
          },
          afterIdentify: async (identity) => {
            hookCalls.push(`after:${identity}`);
          },
        };
        Toggly.addHook(hook);

        Toggly.clearIdentity();

        setTimeout(() => {
          try {
            expect(hookCalls).toEqual(['before:', 'after:']);
            Toggly.removeHook('IdClearHook');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      }, 200);
    });

    it('should not trigger identity hooks when no identity to clear', (done) => {
      localStorage.removeItem(StorageKeys.identityKey);

      const hookCalls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'NoIdHook', version: '1.0.0' }),
        beforeIdentify: async (identity) => {
          hookCalls.push('before');
          return { identity };
        },
      };
      Toggly.addHook(hook);

      Toggly.clearIdentity();

      setTimeout(() => {
        try {
          expect(hookCalls).toEqual([]);
          Toggly.removeHook('NoIdHook');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should persist groups and claims in localStorage', () => {
      Toggly.groups = ['beta', 'enterprise'];
      Toggly.claims = { role: 'admin' };

      expect(Toggly.groups).toEqual(['beta', 'enterprise']);
      expect(Toggly.claims).toEqual({ role: 'admin' });
      expect(Toggly.evaluationContext).toEqual({
        identity: DEFAULT_TEST_IDENTITY,
        groups: ['beta', 'enterprise'],
        claims: { role: 'admin' },
      });
    });

    it('should include identity in API fetch URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      Toggly.identity = 'user-99';

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('?u=user-99');
    });

    it('should handle hook error in identity setter gracefully', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      Toggly.addHook({
        getMetadata: () => ({ name: 'ErrIdHook', version: '1.0.0' }),
        beforeIdentify: async () => {
          throw new Error('Hook error');
        },
      });

      Toggly.identity = 'user-1';

      setTimeout(() => {
        try {
          expect(Toggly.identity).toBe('user-1');
          errorSpy.mockRestore();
          Toggly.removeHook('ErrIdHook');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should handle hook error in clearIdentity gracefully', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      Toggly.identity = 'user-1';
      Toggly.addHook({
        getMetadata: () => ({ name: 'ErrClearHook', version: '1.0.0' }),
        beforeIdentify: async () => {
          throw new Error('Hook error');
        },
      });

      Toggly.clearIdentity();

      setTimeout(() => {
        try {
          expect(
            localStorage.getItem(StorageKeys.identityKey)
          ).toBeNull();
          errorSpy.mockRestore();
          Toggly.removeHook('ErrClearHook');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });
  });

  describe('setContext', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });
      Toggly.identity = 'user-123';
      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });
      mockFetch.mockClear();
    });

    it('should include groups and claims in API URL after setContext', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.setContext({
        identity: 'user-123',
        groups: ['beta', 'enterprise'],
        claims: { role: 'admin', plan: 'premium' },
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('u=user-123');
      expect(url).toContain('g=beta');
      expect(url).toContain('g=enterprise');
      expect(url).toContain('claim.role=admin');
      expect(url).toContain('claim.plan=premium');
    });

    it('setContext should force refresh when only claims change', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: false }),
        });

      await Toggly.setContext({ claims: { role: 'admin' } });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(Toggly.isFeatureOn('F1')).toBe(false);
    });

    it('clearContext should reset evaluation context and refresh', async () => {
      await Toggly.setContext({ groups: ['beta'], claims: { role: 'admin' } });
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.clearContext();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('setContext with empty identity clears identity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.setContext({ identity: '' });

      expect(localStorage.getItem(StorageKeys.identityKey)).toBeNull();
    });

    it('setContext with only groups updates groups and refreshes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.setContext({ groups: ['beta'] });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('g=beta');
    });

    it('setContext should use context-scoped cache key in localStorage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.setContext({
        identity: 'user-123',
        groups: ['beta'],
        claims: { role: 'admin' },
      });

      const cacheKeys = Object.keys(localStorage).filter((key) => key.includes('toggly:flags'));
      expect(cacheKeys.some((key) => key.includes('u:user-123'))).toBe(true);
      expect(cacheKeys.some((key) => key.includes('g:beta'))).toBe(true);
      expect(cacheKeys.some((key) => key.includes('c:role=admin'))).toBe(true);
    });

    it('setContext should append context to variants URL when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: { V: { enabled: true, variant: 'A' } },
          }),
      });

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });
      mockFetch.mockClear();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: { V: { enabled: true, variant: 'A' } },
          }),
      });

      await Toggly.setContext({
        identity: 'user-456',
        groups: ['beta'],
        claims: { tier: 'pro' },
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('evaluated-variants-signed');
      expect(url).toContain('userId=user-456');
      expect(url).toContain('g=beta');
      expect(url).toContain('claim.tier=pro');
    });

    it('setContext with empty groups omits g params on fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.setContext({ groups: [] });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('g=');
    });
  });

  // ───────────────────────────────────────────────
  // Feature Evaluation
  // ───────────────────────────────────────────────
  describe('Feature Evaluation', () => {
    beforeEach(async () => {
      await Toggly.init({
        flagDefaults: {
          Feature1: true,
          Feature2: false,
          Feature3: true,
        },
      });
    });

    describe('isFeatureOn', () => {
      it('should return true for enabled flag', () => {
        expect(Toggly.isFeatureOn('Feature1')).toBe(true);
      });

      it('should return false for disabled flag', () => {
        expect(Toggly.isFeatureOn('Feature2')).toBe(false);
      });

      it('should return falsy for unknown flag', () => {
        expect(Toggly.isFeatureOn('NonExistent')).toBeFalsy();
      });

      it('should trigger evaluation hooks', (done) => {
        const hookCalls: { flagKey: string; result?: boolean }[] = [];
        Toggly.addHook({
          getMetadata: () => ({ name: 'OnHook', version: '1.0.0' }),
          beforeEvaluation: async (flagKey) => {
            hookCalls.push({ flagKey });
            return { flagKey };
          },
          afterEvaluation: async (flagKey, _data, result) => {
            hookCalls.push({ flagKey, result });
          },
        });

        Toggly.isFeatureOn('Feature1');

        setTimeout(() => {
          try {
            expect(hookCalls).toEqual([
              { flagKey: 'Feature1' },
              { flagKey: 'Feature1', result: true },
            ]);
            Toggly.removeHook('OnHook');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });

    describe('isFeatureOff', () => {
      it('should return true for disabled flag', () => {
        expect(Toggly.isFeatureOff('Feature2')).toBe(true);
      });

      it('should return false for enabled flag', () => {
        expect(Toggly.isFeatureOff('Feature1')).toBe(false);
      });

      it('should return true for unknown flag (negated falsy)', () => {
        expect(Toggly.isFeatureOff('NonExistent')).toBe(true);
      });

      it('should trigger evaluation hooks with negated result', (done) => {
        const results: boolean[] = [];
        Toggly.addHook({
          getMetadata: () => ({ name: 'OffHook', version: '1.0.0' }),
          afterEvaluation: async (_flagKey, _data, result) => {
            results.push(result);
          },
        });

        Toggly.isFeatureOff('Feature1');

        setTimeout(() => {
          try {
            expect(results).toEqual([false]);
            Toggly.removeHook('OffHook');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });

    describe('evaluateFeatureGate', () => {
      it('should return true when all flags enabled (requirement: all)', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature1', 'Feature3'],
            FeatureRequirement.all
          )
        ).toBe(true);
      });

      it('should return false when some flags disabled (requirement: all)', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature1', 'Feature2'],
            FeatureRequirement.all
          )
        ).toBeFalsy();
      });

      it('should return true when any flag enabled (requirement: any)', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature1', 'Feature2'],
            FeatureRequirement.any
          )
        ).toBe(true);
      });

      it('should return false when no flags enabled (requirement: any)', () => {
        expect(
          Toggly.evaluateFeatureGate(['Feature2'], FeatureRequirement.any)
        ).toBeFalsy();
      });

      it('should negate enabled result', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature1'],
            FeatureRequirement.all,
            true
          )
        ).toBe(false);
      });

      it('should negate disabled result', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature2'],
            FeatureRequirement.all,
            true
          )
        ).toBe(true);
      });

      it('should return true for empty array (requirement: all)', () => {
        expect(
          Toggly.evaluateFeatureGate([], FeatureRequirement.all)
        ).toBe(true);
      });

      it('should return false for empty array (requirement: any)', () => {
        expect(
          Toggly.evaluateFeatureGate([], FeatureRequirement.any)
        ).toBe(false);
      });

      it('should negate empty array result', () => {
        expect(
          Toggly.evaluateFeatureGate([], FeatureRequirement.all, true)
        ).toBe(false);
        expect(
          Toggly.evaluateFeatureGate([], FeatureRequirement.any, true)
        ).toBe(true);
      });

      it('should treat unknown flags as falsy', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['NonExistent'],
            FeatureRequirement.all
          )
        ).toBeFalsy();
      });

      it('should handle mixed known/unknown flags with any', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature1', 'NonExistent'],
            FeatureRequirement.any
          )
        ).toBe(true);
      });

      it('should handle mixed known/unknown flags with all', () => {
        expect(
          Toggly.evaluateFeatureGate(
            ['Feature1', 'NonExistent'],
            FeatureRequirement.all
          )
        ).toBeFalsy();
      });

      it('should trigger hooks using first key for non-empty gates', (done) => {
        const hookCalls: string[] = [];
        Toggly.addHook({
          getMetadata: () => ({ name: 'GateHook', version: '1.0.0' }),
          beforeEvaluation: async (flagKey) => {
            hookCalls.push(`before:${flagKey}`);
            return { flagKey };
          },
          afterEvaluation: async (flagKey, _data, result) => {
            hookCalls.push(`after:${flagKey}:${result}`);
          },
        });

        Toggly.evaluateFeatureGate(
          ['Feature1', 'Feature2'],
          FeatureRequirement.all
        );

        setTimeout(() => {
          try {
            expect(hookCalls[0]).toBe('before:Feature1');
            expect(hookCalls[1]).toContain('after:Feature1:');
            Toggly.removeHook('GateHook');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });

      it('should not trigger hooks for empty gate', (done) => {
        const hookCalls: string[] = [];
        Toggly.addHook({
          getMetadata: () => ({ name: 'EmptyGateHook', version: '1.0.0' }),
          beforeEvaluation: async (flagKey) => {
            hookCalls.push(flagKey);
            return { flagKey };
          },
        });

        Toggly.evaluateFeatureGate([], FeatureRequirement.all);

        setTimeout(() => {
          try {
            expect(hookCalls).toEqual([]);
            Toggly.removeHook('EmptyGateHook');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });

      it('should default to requirement=all and negate=false', () => {
        expect(Toggly.evaluateFeatureGate(['Feature1', 'Feature3'])).toBe(
          true
        );
        expect(
          Toggly.evaluateFeatureGate(['Feature1', 'Feature2'])
        ).toBeFalsy();
      });
    });

    it('should log debug message during gate evaluation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await Toggly.init({
        flagDefaults: { Feature1: true },
        isDebug: true,
      });

      Toggly.evaluateFeatureGate(['Feature1'], FeatureRequirement.all);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly._evaluateFeatureGate')
      );

      consoleSpy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────
  // Refresh
  // ───────────────────────────────────────────────
  describe('Refresh', () => {
    it('should return flagDefaults when no appKey', async () => {
      await Toggly.init({
        flagDefaults: { F1: true, F2: false },
      });

      const flags = await Toggly.refresh();
      expect(flags).toEqual({ F1: true, F2: false });
    });

    it('should fetch from API when appKey is set', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ ApiFlag: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ RefreshedFlag: true }),
      });

      const flags = await Toggly.refresh();
      expect(flags).toEqual({ RefreshedFlag: true });
    });

    it('should execute afterRefresh hooks', (done) => {
      let refreshedFlags: any = null;
      const hook: Hook = {
        getMetadata: () => ({ name: 'RefreshHook', version: '1.0.0' }),
        afterRefresh: async (flags) => {
          refreshedFlags = flags;
        },
      };

      Toggly.init({
        flagDefaults: { F1: true },
        hooks: [hook],
      }).then(() => {
        // Reset after init's afterRefresh call
        refreshedFlags = null;

        Toggly.refresh().then(() => {
          setTimeout(() => {
            try {
              expect(refreshedFlags).toEqual({ F1: true });
              Toggly.removeHook('RefreshHook');
              done();
            } catch (error) {
              done(error);
            }
          }, 200);
        });
      });
    });

    it('should handle afterRefresh hook error gracefully', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      await Toggly.init({
        flagDefaults: { F1: true },
        hooks: [
          {
            getMetadata: () => ({
              name: 'ErrRefreshHook',
              version: '1.0.0',
            }),
            afterRefresh: async () => {
              throw new Error('Refresh hook error');
            },
          },
        ],
      });

      // Should not throw
      const flags = await Toggly.refresh();
      await waitForHooks();

      expect(flags).toEqual({ F1: true });

      errorSpy.mockRestore();
      Toggly.removeHook('ErrRefreshHook');
    });

    it('should log debug messages during refresh', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await Toggly.init({
        flagDefaults: { F1: true },
        isDebug: true,
      });

      consoleSpy.mockClear();

      await Toggly.refresh();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.refresh')
      );

      consoleSpy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────
  // Hook Management
  // ───────────────────────────────────────────────
  describe('Hook Management', () => {
    beforeEach(async () => {
      await Toggly.init({ flagDefaults: { F1: true } });
    });

    it('should add hook via addHook', (done) => {
      const calls: string[] = [];
      Toggly.addHook({
        getMetadata: () => ({ name: 'DynHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey) => {
          calls.push(flagKey);
          return { flagKey };
        },
      });

      Toggly.isFeatureOn('F1');

      setTimeout(() => {
        try {
          expect(calls).toContain('F1');
          Toggly.removeHook('DynHook');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    it('should remove hook and return true', () => {
      Toggly.addHook({
        getMetadata: () => ({ name: 'ToRemove', version: '1.0.0' }),
      });

      const removed = Toggly.removeHook('ToRemove');
      expect(removed).toBe(true);
    });

    it('should return false when removing non-existent hook', () => {
      const removed = Toggly.removeHook('NonExistent');
      expect(removed).toBe(false);
    });

    it('should prevent duplicate hook registration by name', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      Toggly.addHook({
        getMetadata: () => ({ name: 'DupHook', version: '1.0.0' }),
      });
      Toggly.addHook({
        getMetadata: () => ({ name: 'DupHook', version: '2.0.0' }),
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );

      warnSpy.mockRestore();
      Toggly.removeHook('DupHook');
    });

    it('should stop calling removed hook', (done) => {
      let callCount = 0;
      Toggly.addHook({
        getMetadata: () => ({ name: 'RemovableHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey) => {
          callCount++;
          return { flagKey };
        },
      });

      Toggly.isFeatureOn('F1');

      setTimeout(() => {
        try {
          expect(callCount).toBe(1);

          Toggly.removeHook('RemovableHook');

          Toggly.isFeatureOn('F1');

          setTimeout(() => {
            try {
              expect(callCount).toBe(1); // No new calls
              done();
            } catch (error) {
              done(error);
            }
          }, 200);
        } catch (error) {
          done(error);
        }
      }, 200);
    });
  });

  // ───────────────────────────────────────────────
  // Edge Cases
  // ───────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should handle special characters in feature keys', async () => {
      await Toggly.init({
        flagDefaults: {
          'Feature.With.Dots': true,
          'Feature-With-Dashes': false,
          Feature_With_Underscores: true,
          'Feature With Spaces': false,
        },
      });

      expect(Toggly.isFeatureOn('Feature.With.Dots')).toBe(true);
      expect(Toggly.isFeatureOn('Feature-With-Dashes')).toBe(false);
      expect(Toggly.isFeatureOn('Feature_With_Underscores')).toBe(true);
      expect(Toggly.isFeatureOn('Feature With Spaces')).toBe(false);
    });

    it('should handle large number of flags (1000+)', async () => {
      const flags: Record<string, boolean> = {};
      for (let i = 0; i < 1000; i++) {
        flags[`Flag${i}`] = i % 2 === 0;
      }

      await Toggly.init({ flagDefaults: flags });

      expect(Toggly.isFeatureOn('Flag0')).toBe(true);
      expect(Toggly.isFeatureOn('Flag1')).toBe(false);
      expect(Toggly.isFeatureOn('Flag998')).toBe(true);
      expect(Toggly.isFeatureOn('Flag999')).toBe(false);
    });

    it('should expose Toggly on window global', () => {
      expect((window as any).Toggly).toBe(Toggly);
    });

    it('should handle multiple rapid refresh calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      const results = await Promise.all([
        Toggly.refresh(),
        Toggly.refresh(),
        Toggly.refresh(),
      ]);

      results.forEach((flags) => {
        expect(flags).toEqual({ F1: true });
      });
    });

    it('should handle feature evaluation with API-fetched flags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            RemoteFeature1: true,
            RemoteFeature2: false,
          }),
      });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.isFeatureOn('RemoteFeature1')).toBe(true);
      expect(Toggly.isFeatureOn('RemoteFeature2')).toBe(false);
      expect(
        Toggly.evaluateFeatureGate(
          ['RemoteFeature1', 'RemoteFeature2'],
          FeatureRequirement.any
        )
      ).toBe(true);
      expect(
        Toggly.evaluateFeatureGate(
          ['RemoteFeature1', 'RemoteFeature2'],
          FeatureRequirement.all
        )
      ).toBeFalsy();
    });

    it('should update flags after refresh', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: false, F2: true }),
        });

      await Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.isFeatureOn('F1')).toBe(true);

      await Toggly.refresh();

      expect(Toggly.isFeatureOn('F1')).toBe(false);
      expect(Toggly.isFeatureOn('F2')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // Model Types
  // ───────────────────────────────────────────────
  describe('Model Types', () => {
    it('should export FeatureRequirement enum with correct values', () => {
      expect(FeatureRequirement.all).toBe(0);
      expect(FeatureRequirement.any).toBe(1);
    });

    it('should export StorageKeys with correct values', () => {
      expect(StorageKeys.identityKey).toBe('toggly:identity');
      expect(StorageKeys.flagsCacheKey('myApp', 'Production')).toBe('toggly:flags:myApp:Production');
    });

    it('should construct TogglyInitResponse with status', () => {
      const response = new TogglyInitResponse(
        TogglyLoadFeatureFlagsResponse.fetched
      );
      expect(response.status).toBe(TogglyLoadFeatureFlagsResponse.fetched);

      const defaultsResponse = new TogglyInitResponse(
        TogglyLoadFeatureFlagsResponse.defaults
      );
      expect(defaultsResponse.status).toBe(
        TogglyLoadFeatureFlagsResponse.defaults
      );
    });
  });

  // ───────────────────────────────────────────────
  // Error catch paths (hook executor rejection)
  // ───────────────────────────────────────────────
  describe('Hook Executor Rejection Handling', () => {
    beforeEach(async () => {
      await Toggly.init({ flagDefaults: { F1: true } });
    });

    it('should handle executor rejection in isFeatureOn', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const executor = (Toggly as any)._hookExecutor;
      const original = executor.executeBeforeEvaluation.bind(executor);
      executor.executeBeforeEvaluation = () =>
        Promise.reject(new Error('executor fail'));

      Toggly.isFeatureOn('F1');

      setTimeout(() => {
        try {
          expect(errorSpy).toHaveBeenCalledWith(
            '[Toggly] Hook execution error:',
            expect.any(Error)
          );
          executor.executeBeforeEvaluation = original;
          errorSpy.mockRestore();
          done();
        } catch (error) {
          executor.executeBeforeEvaluation = original;
          errorSpy.mockRestore();
          done(error);
        }
      }, 200);
    });

    it('should handle executor rejection in isFeatureOff', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const executor = (Toggly as any)._hookExecutor;
      const original = executor.executeBeforeEvaluation.bind(executor);
      executor.executeBeforeEvaluation = () =>
        Promise.reject(new Error('executor fail'));

      Toggly.isFeatureOff('F1');

      setTimeout(() => {
        try {
          expect(errorSpy).toHaveBeenCalledWith(
            '[Toggly] Hook execution error:',
            expect.any(Error)
          );
          executor.executeBeforeEvaluation = original;
          errorSpy.mockRestore();
          done();
        } catch (error) {
          executor.executeBeforeEvaluation = original;
          errorSpy.mockRestore();
          done(error);
        }
      }, 200);
    });

    it('should handle executor rejection in evaluateFeatureGate', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const executor = (Toggly as any)._hookExecutor;
      const original = executor.executeBeforeEvaluation.bind(executor);
      executor.executeBeforeEvaluation = () =>
        Promise.reject(new Error('executor fail'));

      Toggly.evaluateFeatureGate(['F1'], FeatureRequirement.all);

      setTimeout(() => {
        try {
          expect(errorSpy).toHaveBeenCalledWith(
            '[Toggly] Hook execution error:',
            expect.any(Error)
          );
          executor.executeBeforeEvaluation = original;
          errorSpy.mockRestore();
          done();
        } catch (error) {
          executor.executeBeforeEvaluation = original;
          errorSpy.mockRestore();
          done(error);
        }
      }, 200);
    });

    it('should handle executor rejection in identity setter', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const executor = (Toggly as any)._hookExecutor;
      const original = executor.executeBeforeIdentify.bind(executor);
      executor.executeBeforeIdentify = () =>
        Promise.reject(new Error('executor fail'));

      Toggly.identity = 'user-x';

      setTimeout(() => {
        try {
          expect(errorSpy).toHaveBeenCalledWith(
            '[Toggly] Hook execution error:',
            expect.any(Error)
          );
          executor.executeBeforeIdentify = original;
          errorSpy.mockRestore();
          done();
        } catch (error) {
          executor.executeBeforeIdentify = original;
          errorSpy.mockRestore();
          done(error);
        }
      }, 200);
    });

    it('should handle executor rejection in clearIdentity', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      Toggly.identity = 'user-clear';

      setTimeout(() => {
        const executor = (Toggly as any)._hookExecutor;
        const original = executor.executeBeforeIdentify.bind(executor);
        executor.executeBeforeIdentify = () =>
          Promise.reject(new Error('executor fail'));

        Toggly.clearIdentity();

        setTimeout(() => {
          try {
            expect(errorSpy).toHaveBeenCalledWith(
              '[Toggly] Hook execution error:',
              expect.any(Error)
            );
            executor.executeBeforeIdentify = original;
            errorSpy.mockRestore();
            done();
          } catch (error) {
            executor.executeBeforeIdentify = original;
            errorSpy.mockRestore();
            done(error);
          }
        }, 200);
      }, 200);
    });

    it('should handle executor rejection in _loadFeatureFlags (no appKey)', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const executor = (Toggly as any)._hookExecutor;
      const original = executor.executeAfterRefresh.bind(executor);
      executor.executeAfterRefresh = () =>
        Promise.reject(new Error('refresh fail'));

      Toggly.refresh().then(() => {
        setTimeout(() => {
          try {
            expect(errorSpy).toHaveBeenCalledWith(
              '[Toggly] Hook execution error:',
              expect.any(Error)
            );
            executor.executeAfterRefresh = original;
            errorSpy.mockRestore();
            done();
          } catch (error) {
            executor.executeAfterRefresh = original;
            errorSpy.mockRestore();
            done(error);
          }
        }, 200);
      });
    });

    it('should handle executor rejection in _loadFeatureFlags (with appKey)', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      Toggly.init({
        appKey: 'key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      }).then(() => {
        const executor = (Toggly as any)._hookExecutor;
        const original = executor.executeAfterRefresh.bind(executor);
        executor.executeAfterRefresh = () =>
          Promise.reject(new Error('refresh fail'));

        mockFetch.mockResolvedValueOnce({
          ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
        });

        Toggly.refresh().then(() => {
          setTimeout(() => {
            try {
              expect(errorSpy).toHaveBeenCalledWith(
                '[Toggly] Hook execution error:',
                expect.any(Error)
              );
              executor.executeAfterRefresh = original;
              errorSpy.mockRestore();
              done();
            } catch (error) {
              executor.executeAfterRefresh = original;
              errorSpy.mockRestore();
              done(error);
            }
          }, 200);
        });
      });
    });
  });

  // ───────────────────────────────────────────────
  // Hook error paths (afterEvaluation / afterIdentify)
  // ───────────────────────────────────────────────
  describe('Hook After-Method Error Handling', () => {
    beforeEach(async () => {
      await Toggly.init({ flagDefaults: { F1: true } });
    });

    it('should catch error in afterEvaluation hook', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      Toggly.addHook({
        getMetadata: () => ({ name: 'AfterEvalErr', version: '1.0.0' }),
        afterEvaluation: async () => {
          throw new Error('afterEval error');
        },
      });

      Toggly.isFeatureOn('F1');

      setTimeout(() => {
        try {
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('AfterEvalErr.afterEvaluation'),
            expect.any(Error)
          );
          Toggly.removeHook('AfterEvalErr');
          errorSpy.mockRestore();
          done();
        } catch (error) {
          Toggly.removeHook('AfterEvalErr');
          errorSpy.mockRestore();
          done(error);
        }
      }, 200);
    });

    it('should catch error in afterIdentify hook', (done) => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      Toggly.addHook({
        getMetadata: () => ({ name: 'AfterIdErr', version: '1.0.0' }),
        afterIdentify: async () => {
          throw new Error('afterId error');
        },
      });

      Toggly.identity = 'user-err';

      setTimeout(() => {
        try {
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('AfterIdErr.afterIdentify'),
            expect.any(Error)
          );
          Toggly.removeHook('AfterIdErr');
          errorSpy.mockRestore();
          done();
        } catch (error) {
          Toggly.removeHook('AfterIdErr');
          errorSpy.mockRestore();
          done(error);
        }
      }, 200);
    });
  });

  // ───────────────────────────────────────────────
  // Variants
  // ───────────────────────────────────────────────
  describe('Variants', () => {
    const variantsKey = variantsCacheKeyForContext('test-app-key', 'Production');
    const flagsKey = flagsCacheKeyForContext('test-app-key', 'Production');

    it('should fetch variants and cache both flags and variants when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            F1: { enabled: true, variant: 'A', configurationValue: { color: 'red' } },
            F2: { enabled: false },
          }),
      });

      const flags = await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('evaluated-variants-signed/test-app-key/Production'),
        fetchInitMatcher,
      );
      expect(flags).toEqual({ F1: true, F2: false });
      expect(JSON.parse(localStorage.getItem(flagsKey)!)).toEqual({ F1: true, F2: false });
      expect(JSON.parse(localStorage.getItem(variantsKey)!)).toEqual({
        F1: { enabled: true, variant: 'A', configurationValue: { color: 'red' } },
        F2: { enabled: false },
      });
    });

    it('should include identity in variants fetch URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      });

      localStorage.setItem(StorageKeys.identityKey, 'user-1');

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('userId=user-1');
    });

    it('should unwrap payload.defs from variants endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              F1: { enabled: true, variant: 'B' },
            },
          }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(JSON.parse(localStorage.getItem(variantsKey)!)).toEqual({
        F1: { enabled: true, variant: 'B' },
      });
    });

    it('should log debug message on successful variants fetch', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: { enabled: true } }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        isDebug: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.fetchFeatureFlagsWithVariants')
      );
      consoleSpy.mockRestore();
    });

    it('should fall back to cached flags when variants fetch fails', async () => {
      localStorage.setItem(flagsKey, JSON.stringify({ Cached: true }));
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const flags = await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(flags).toEqual({ Cached: true });
    });

    it('should fall back to flagDefaults when variants fetch fails and no cache', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const flags = await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        flagDefaults: { Default: true },
        featureFlagsRefreshInterval: 0,
      });

      expect(flags).toEqual({ Default: true });
    });

    it('should log debug message on variants fetch fallback', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      mockFetch.mockRejectedValueOnce(new Error('network'));

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        flagDefaults: { F1: true },
        isDebug: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Toggly.loadedFromCache')
      );
      consoleSpy.mockRestore();
    });

    it('variantsValue should return null when enableVariants is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.variantsValue).toBeNull();
    });

    it('variantsValue should return cached variants when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({ F1: { enabled: true, variant: 'A' } }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.variantsValue).toEqual({
        F1: { enabled: true, variant: 'A' },
      });
    });

    it('variantsValue should return null when cached JSON is corrupted', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      localStorage.setItem(variantsKey, 'not-json{{');
      expect(Toggly.variantsValue).toBeNull();
    });

    it('cacheVariants should store variants in localStorage', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));
      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      Toggly.cacheVariants({ F1: { enabled: true, variant: 'X' } });

      expect(JSON.parse(localStorage.getItem(variantsKey)!)).toEqual({
        F1: { enabled: true, variant: 'X' },
      });
    });

    it('cacheVariants should be a no-op when persistCache is false', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));
      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        persistCache: false,
        featureFlagsRefreshInterval: 0,
      });

      Toggly.cacheVariants({ F1: { enabled: true, variant: 'X' } });

      expect(localStorage.getItem(variantsKey)).toBeNull();
    });

    it('getVariant should return assigned variant with configurationValue', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            F1: { enabled: true, variant: 'A', configurationValue: { theme: 'dark' } },
          }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.getVariant('F1')).toEqual({
        name: 'A',
        configurationValue: { theme: 'dark' },
      });
    });

    it('getVariant should return null when variants are disabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.getVariant('F1')).toBeNull();
    });

    it('getVariant should return null for an unknown feature key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: { enabled: true, variant: 'A' } }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.getVariant('Unknown')).toBeNull();
    });

    it('getVariant should return null when entry has no variant assigned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: { enabled: true } }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.getVariant('F1')).toBeNull();
    });

    it('getVariantValue should return configurationValue when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            F1: { enabled: true, variant: 'A', configurationValue: 42 },
          }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.getVariantValue('F1')).toBe(42);
    });

    it('getVariantValue should return null when no variant or value is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: { enabled: true, variant: 'A' } }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(Toggly.getVariantValue('F1')).toBeNull();
      expect(Toggly.getVariantValue('Unknown')).toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // Local gates (post-filter)
  // ───────────────────────────────────────────────
  describe('Local gates', () => {
    it('should AND remote true with local gate when gate is off', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ ApiV2Checkout: true, Other: true }),
      });

      let gateEnabled = false;
      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
        localGates: [{
          id: 'apiRedesign',
          flagKeys: ['ApiV2Checkout'],
          isEnabled: () => gateEnabled,
        }],
      });

      expect(Toggly.isFeatureOn('ApiV2Checkout')).toBe(false);
      expect(Toggly.isFeatureOn('Other')).toBe(true);
    });

    it('should pass remote through when local gate is on', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ ApiV2Checkout: true }),
      });

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
        localGates: [{
          id: 'apiRedesign',
          flagKeys: ['ApiV2Checkout'],
          isEnabled: () => true,
        }],
      });

      expect(Toggly.isFeatureOn('ApiV2Checkout')).toBe(true);
    });

    it('notifyLocalGatesChanged should notify subscribers without fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ ApiV2Checkout: true }),
      });

      let gateEnabled = true;
      const listener = jest.fn();
      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
        localGates: [{
          id: 'apiRedesign',
          flagKeys: ['ApiV2Checkout'],
          isEnabled: () => gateEnabled,
        }],
      });

      const unsub = Toggly.subscribeLocalGatesChanged(listener);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      gateEnabled = false;
      Toggly.notifyLocalGatesChanged();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(Toggly.isFeatureOn('ApiV2Checkout')).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      unsub();
      Toggly.notifyLocalGatesChanged();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('setLocalGates should update gates after init', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ ApiV2Checkout: true }),
      });

      let gateEnabled = false;
      await Toggly.init({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      Toggly.setLocalGates([{
        id: 'apiRedesign',
        flagKeys: ['ApiV2Checkout'],
        isEnabled: () => gateEnabled,
      }]);

      expect(Toggly.isFeatureOn('ApiV2Checkout')).toBe(false);

      gateEnabled = true;
      Toggly.notifyLocalGatesChanged();
      expect(Toggly.isFeatureOn('ApiV2Checkout')).toBe(true);
    });

    it('should hide variant when local gate is off', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            ApiV2Checkout: { enabled: true, variant: 'A', configurationValue: 1 },
          }),
      });

      await Toggly.init({
        appKey: 'test-app-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
        localGates: [{
          id: 'apiRedesign',
          flagKeys: ['ApiV2Checkout'],
          isEnabled: () => false,
        }],
      });

      expect(Toggly.getVariant('ApiV2Checkout')).toBeNull();
    });
  });
});
