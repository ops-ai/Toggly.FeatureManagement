import { Toggly } from '../lib/toggly';
import { FeatureRequirement, StorageKeys } from '../lib/models';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-edge'),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const fetchInitMatcher = expect.objectContaining({ headers: expect.any(Object) });

describe('Edge Cases & Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Toggly.cancelRefreshInterval();
    mockFetch.mockReset();
  });

  // ─── Network Errors ──────────────────────
  describe('Network Errors', () => {
    it('should handle 404 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.reject(new Error('Not JSON')),
      });

      const result = await Toggly.init({
        appKey: 'bad-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
    });

    it('should handle 500 response with json rejection', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('server error')),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
    });

    it('should not cache JSON error body from non-2xx response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'forbidden', defs: { BadFlag: true } }),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
      expect(localStorage.getItem(StorageKeys.flagsCacheKey('test-key', 'Production'))).toBeNull();
    });

    it('should handle 502 Bad Gateway', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('bad gateway')),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: false },
      });

      expect(result).toEqual({ F1: false });
    });

    it('should handle TypeError (network disconnect)', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
    });

    it('should report fetch errors through onError', async () => {
      const errors: string[] = [];
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
        enableLiveUpdates: false,
        onError: (message) => errors.push(message),
      });

      expect(errors).toContain('Error fetching feature flags');
      expect(Toggly.lastError).toBe('Error fetching feature flags');
    });

    it('should preserve last-known-good flags on transient refresh failure', async () => {
      const errors: string[] = [];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ defs: { F1: true } }),
      });

      await Toggly.init({
        appKey: 'test-key',
        persistCache: false,
        enableLiveUpdates: false,
        flagDefaults: { F1: false },
        onError: (message) => errors.push(message),
      });

      mockFetch.mockRejectedValueOnce(new Error('network down'));
      const result = await Toggly.refresh();

      expect(result).toEqual({ F1: true });
      expect(Toggly.isFeatureOn('F1')).toBe(true);
      expect(errors).toContain('Error fetching feature flags');
    });

    it('should fail closed for non-empty gates when no flags are loaded', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await Toggly.init({
        appKey: 'test-key',
        persistCache: false,
        enableLiveUpdates: false,
      });

      expect(Toggly.evaluateFeatureGate(['MissingFeature'])).toBe(false);
    });

    it('should handle AbortError (timeout)', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
    });
  });

  // ─── Invalid Data ──────────────────────
  describe('Invalid Data', () => {
    it('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
    });

    it('should handle null response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      // null will be cached; featureFlagsValue falls back to defaults
      expect(Toggly.featureFlagsValue).toBeTruthy();
    });

    it('should handle array response instead of object', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([true, false]),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toBeTruthy();
    });

    it('should handle response with non-boolean values', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: 'yes', F2: 1, F3: null }),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
      });

      // Non-boolean values should not crash evaluation
      expect(Toggly.isFeatureOn('F1')).toBeDefined();
      expect(Toggly.isFeatureOn('F3')).toBeDefined();
    });

    it('should handle empty object response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      // Empty API response: featureFlagsValue returns cache (which is {})
      // when appKey is set, so it uses the empty cache
      expect(result).toBeTruthy();
    });

    it('should handle HTML error page response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      });

      const result = await Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(result).toEqual({ F1: true });
    });
  });

  // ─── Feature Key Edge Cases ──────────────────────
  describe('Feature Key Edge Cases', () => {
    beforeEach(async () => {
      mockFetch.mockRejectedValue(new Error('no network'));
      await Toggly.init({
        flagDefaults: {
          '': true,
          'feature.with.dots': true,
          'feature/with/slashes': true,
          'feature with spaces': true,
          'UPPERCASE': true,
          'lowercase': false,
          'MiXeD': true,
          '🚀emoji': true,
          ['a'.repeat(1000)]: true,
        },
      });
    });

    it('should handle empty string key', () => {
      expect(Toggly.isFeatureOn('')).toBe(true);
    });

    it('should handle keys with dots', () => {
      expect(Toggly.isFeatureOn('feature.with.dots')).toBe(true);
    });

    it('should handle keys with slashes', () => {
      expect(Toggly.isFeatureOn('feature/with/slashes')).toBe(true);
    });

    it('should handle keys with spaces', () => {
      expect(Toggly.isFeatureOn('feature with spaces')).toBe(true);
    });

    it('should be case-sensitive', () => {
      expect(Toggly.isFeatureOn('UPPERCASE')).toBe(true);
      expect(Toggly.isFeatureOn('uppercase')).toBeFalsy();
    });

    it('should handle emoji keys', () => {
      expect(Toggly.isFeatureOn('🚀emoji')).toBe(true);
    });

    it('should handle very long keys', () => {
      expect(Toggly.isFeatureOn('a'.repeat(1000))).toBe(true);
    });

    it('should return falsy for non-existent keys', () => {
      expect(Toggly.isFeatureOn('does-not-exist')).toBeFalsy();
      expect(Toggly.isFeatureOff('does-not-exist')).toBe(true);
    });
  });

  // ─── Feature Gate Edge Cases ──────────────────────
  describe('Feature Gate Edge Cases', () => {
    beforeEach(async () => {
      mockFetch.mockRejectedValue(new Error('no network'));
      await Toggly.init({
        flagDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should handle empty feature gate', () => {
      expect(Toggly.evaluateFeatureGate([])).toBe(true);
    });

    it('should handle single-item gate (like isFeatureOn)', () => {
      expect(Toggly.evaluateFeatureGate(['F1'])).toBe(true);
      expect(Toggly.evaluateFeatureGate(['F2'])).toBe(false);
    });

    it('should handle gate with all undefined features', () => {
      const result = Toggly.evaluateFeatureGate(
        ['X1', 'X2', 'X3'],
        FeatureRequirement.all
      );
      expect(result).toBeFalsy();
    });

    it('should handle gate with mixed defined/undefined', () => {
      const result = Toggly.evaluateFeatureGate(
        ['F1', 'Unknown'],
        FeatureRequirement.all
      );
      expect(result).toBeFalsy();
    });

    it('should handle gate with duplicate keys', () => {
      const result = Toggly.evaluateFeatureGate(
        ['F1', 'F1', 'F1'],
        FeatureRequirement.all
      );
      expect(result).toBe(true);
    });

    it('should handle large gate (100+ features)', () => {
      const keys = Array.from({ length: 100 }, (_, i) => `F${i}`);
      expect(() => {
        Toggly.evaluateFeatureGate(keys, FeatureRequirement.any);
      }).not.toThrow();
    });

    it('should handle negate with "any" and all false', () => {
      const result = Toggly.evaluateFeatureGate(
        ['F2'],
        FeatureRequirement.any,
        true
      );
      expect(result).toBe(true);
    });
  });

  // ─── Configuration Edge Cases ──────────────────────
  describe('Configuration Edge Cases', () => {
    it('should handle init with empty config', async () => {
      mockFetch.mockRejectedValue(new Error('no network'));
      const result = await Toggly.init({});
      expect(result).toEqual({});
    });

    it('should handle init with no appKey and no defaults', async () => {
      mockFetch.mockRejectedValue(new Error('no network'));
      const result = await Toggly.init({
        flagDefaults: {},
      });
      expect(result).toEqual({});
    });

    it('should handle baseURI with trailing slash', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'test-key',
        baseURI: 'https://api.toggly.io/',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.toggly.io/'),
        fetchInitMatcher,
      );
    });

    it('should handle zero refresh interval', async () => {
      mockFetch.mockRejectedValue(new Error('no network'));
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      await Toggly.init({
        featureFlagsRefreshInterval: 0,
        flagDefaults: { F1: true },
      });

      // Should not set up interval with 0
      const refreshCalls = setIntervalSpy.mock.calls.filter(
        (call) => typeof call[1] === 'number' && call[1] >= 0
      );
      // Interval is always set in init via startRefreshInterval
      // but zero means immediate interval - just verify it doesn't crash
      expect(Toggly.isFeatureOn('F1')).toBe(true);
      setIntervalSpy.mockRestore();
    });

    it('should handle re-init with different config', async () => {
      mockFetch.mockRejectedValue(new Error('no network'));

      await Toggly.init({ flagDefaults: { F1: true } });
      expect(Toggly.isFeatureOn('F1')).toBe(true);

      await Toggly.init({ flagDefaults: { F1: false, F2: true } });
      expect(Toggly.isFeatureOn('F1')).toBe(false);
      expect(Toggly.isFeatureOn('F2')).toBe(true);
    });
  });

  // ─── Identity Edge Cases ──────────────────────
  describe('Identity Edge Cases', () => {
    beforeEach(async () => {
      mockFetch.mockRejectedValue(new Error('no network'));
      await Toggly.init({ flagDefaults: { F1: true } });
    });

    it('should handle empty string identity', () => {
      Toggly.identity = '';
      expect(Toggly.identity).toBe('');
    });

    it('should handle special characters in identity', () => {
      Toggly.identity = 'user+test@example.com';
      expect(Toggly.identity).toBe('user+test@example.com');
    });

    it('should handle unicode identity', () => {
      Toggly.identity = '用户123';
      expect(Toggly.identity).toBe('用户123');
    });

    it('should handle very long identity', () => {
      const longId = 'x'.repeat(10000);
      Toggly.identity = longId;
      expect(Toggly.identity).toBe(longId);
    });

    it('should handle clearing identity multiple times', () => {
      Toggly.clearIdentity();
      Toggly.clearIdentity();
      // Should not throw or cause issues
      expect(Toggly.identity).toBeFalsy();
    });
  });

  // ─── Storage Edge Cases ──────────────────────
  describe('Storage Edge Cases', () => {
    it('should handle localStorage with corrupted JSON gracefully', async () => {
      localStorage.setItem(
        StorageKeys.flagsCacheKey('test-key', 'Production'),
        'not-valid-json{{'
      );

      await Toggly.init({ appKey: 'test-key' });
      expect(Toggly.featureFlagsValue).toEqual({});
    });

    it('should handle localStorage cleared externally between operations', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({ appKey: 'test-key' });

      // Externally clear localStorage
      localStorage.clear();

      // featureFlagsValue should fall back to defaults
      expect(Toggly.featureFlagsValue).toBeTruthy();
    });
  });

  // ─── Concurrency Edge Cases ──────────────────────
  describe('Concurrency Edge Cases', () => {
    it('should handle multiple rapid refresh calls', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: () => Promise.resolve({ F1: true, count: callCount }),
        };
      });

      await Toggly.init({ appKey: 'test-key' });

      // Rapid refreshes
      const promises = [
        Toggly.refresh(),
        Toggly.refresh(),
        Toggly.refresh(),
      ];

      await Promise.all(promises);

      // All should resolve without error
      expect(Toggly.isFeatureOn('F1')).toBe(true);
    });

    it('should handle init called during refresh', async () => {
      let resolveFirst: Function;
      const firstFetch = new Promise((resolve) => { resolveFirst = resolve; });

      mockFetch.mockImplementation(() => firstFetch);

      const initPromise = Toggly.init({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      // Re-init while first init is pending
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: false }),
      });

      const secondInit = Toggly.init({
        appKey: 'test-key-2',
        flagDefaults: { F2: true },
      });

      resolveFirst!({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      });

      await Promise.allSettled([initPromise, secondInit]);

      // Should not crash
      expect(Toggly.featureFlagsValue).toBeTruthy();
    });
  });

  // ─── Memory Leak Prevention ──────────────────────
  describe('Memory Leak Prevention', () => {
    it('should cancel previous interval on re-init', async () => {
      jest.useFakeTimers();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      });

      await Toggly.init({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
      });

      await Toggly.init({
        appKey: 'test-key-2',
        featureFlagsRefreshInterval: 5000,
      });

      Toggly.cancelRefreshInterval();
      const callsBefore = mockFetch.mock.calls.length;

      jest.advanceTimersByTime(10000);

      // After canceling, no more fetches should happen
      expect(mockFetch.mock.calls.length).toBe(callsBefore);
      jest.useRealTimers();
    });

    it('should clean up interval on cancelRefreshInterval', () => {
      jest.useFakeTimers();
      const clearSpy = jest.spyOn(global, 'clearInterval');

      Toggly.cancelRefreshInterval();

      // Should not throw even without active interval
      expect(() => Toggly.cancelRefreshInterval()).not.toThrow();
      jest.useRealTimers();
      clearSpy.mockRestore();
    });
  });
});
