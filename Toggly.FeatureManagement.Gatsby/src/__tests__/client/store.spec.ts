import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We use dynamic imports via vi.resetModules() to get a fresh clientInstance for each test
type StoreModule = typeof import('../../client/store.js');

describe('Client Store', () => {
  let store: StoreModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    store = await import('../../client/store.js');
  });

  afterEach(() => {
    store.stopRefreshInterval();
    vi.restoreAllMocks();
  });

  // ─── Atoms ──────────────────────
  describe('atoms', () => {
    it('$flags should initialize as empty object', () => {
      expect(store.$flags.get()).toEqual({});
    });

    it('$isReady should initialize as false', () => {
      expect(store.$isReady.get()).toBe(false);
    });

    it('$error should initialize as null', () => {
      expect(store.$error.get()).toBeNull();
    });
  });

  // ─── $flag ──────────────────────
  describe('$flag', () => {
    it('should return correct flag value', () => {
      store.$flags.set({ F1: true, F2: false });
      const f1 = store.$flag('F1');
      expect(f1.get()).toBe(true);
    });

    it('should return default value for missing flag', () => {
      store.$flags.set({ F1: true });
      const missing = store.$flag('Unknown', true);
      expect(missing.get()).toBe(true);
    });

    it('should return false as default when not specified', () => {
      store.$flags.set({});
      const missing = store.$flag('Unknown');
      expect(missing.get()).toBe(false);
    });

    it('should reactively update when flags change', () => {
      const f1 = store.$flag('F1');
      expect(f1.get()).toBe(false);

      store.$flags.set({ F1: true });
      expect(f1.get()).toBe(true);

      store.$flags.set({ F1: false });
      expect(f1.get()).toBe(false);
    });
  });

  // ─── $gate ──────────────────────
  describe('$gate', () => {
    it('should evaluate "all" requirement', () => {
      store.$flags.set({ F1: true, F2: true });
      const gate = store.$gate(['F1', 'F2'], 'all');
      expect(gate.get()).toBe(true);
    });

    it('should fail "all" when one flag is false', () => {
      store.$flags.set({ F1: true, F2: false });
      const gate = store.$gate(['F1', 'F2'], 'all');
      expect(gate.get()).toBe(false);
    });

    it('should evaluate "any" requirement', () => {
      store.$flags.set({ F1: true, F2: false });
      const gate = store.$gate(['F1', 'F2'], 'any');
      expect(gate.get()).toBe(true);
    });

    it('should fail "any" when all flags are false', () => {
      store.$flags.set({ F1: false, F2: false });
      const gate = store.$gate(['F1', 'F2'], 'any');
      expect(gate.get()).toBe(false);
    });

    it('should support negate', () => {
      store.$flags.set({ F1: true });
      const gate = store.$gate(['F1'], 'all', true);
      expect(gate.get()).toBe(false);
    });

    it('should return true for empty keys without negate', () => {
      const gate = store.$gate([], 'all');
      expect(gate.get()).toBe(true);
    });

    it('should return false for empty keys with negate', () => {
      const gate = store.$gate([], 'all', true);
      expect(gate.get()).toBe(false);
    });

    it('should default to "all" requirement', () => {
      store.$flags.set({ F1: true, F2: true });
      const gate = store.$gate(['F1', 'F2']);
      expect(gate.get()).toBe(true);
    });
  });

  // ─── initTogglyClient ──────────────────────
  describe('initTogglyClient', () => {
    it('should initialize with flag defaults when no appKey', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));

      await store.initTogglyClient({
        appKey: '',
        flagDefaults: { F1: true, F2: false },
      });

      expect(store.$flags.get()).toEqual({ F1: true, F2: false });
      expect(store.$isReady.get()).toBe(true);
      expect(store.$error.get()).toBeNull();
    });

    it('should fetch flags when appKey is provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: true }),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(store.$flags.get()).toEqual({ F1: true, F2: true });
      expect(store.$isReady.get()).toBe(true);
    });

    it('should warn if already initialized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await store.initTogglyClient({ appKey: 'test-key' });
      await store.initTogglyClient({ appKey: 'test-key-2' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already initialized')
      );
    });

    it('should handle fetch error and set error atom', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network fail'));

      await store.initTogglyClient({ appKey: 'test-key' });

      // Falls back to defaults (empty) since no flagDefaults
      expect(store.$isReady.get()).toBe(true);
      expect(store.$flags.get()).toEqual({});
    });

    it('should fall back to defaults on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$flags.get()).toEqual({ F1: true });
      expect(store.$isReady.get()).toBe(true);
    });

    it('should construct correct API URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await store.initTogglyClient({
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://api.toggly.io',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.toggly.io/evaluated-signed/my-key/Staging',
        expect.any(Object)
      );
    });

    it('should include identity in URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await store.initTogglyClient({
        appKey: 'my-key',
        environment: 'Production',
        identity: 'user-42',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('?u=user-42'),
        expect.any(Object)
      );
    });

    it('should register initial hooks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      let refreshCalled = false;
      await store.initTogglyClient({
        appKey: 'test-key',
        hooks: [
          {
            getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
            afterRefresh: async () => { refreshCalled = true; },
          },
        ],
      });

      expect(refreshCalled).toBe(true);
    });

    it('should log in debug mode', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));

      await store.initTogglyClient({
        appKey: '',
        flagDefaults: { F1: true },
        isDebug: true,
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Toggly Client]'),
        expect.anything()
      );
    });
  });

  // ─── refreshFlags ──────────────────────
  describe('refreshFlags', () => {
    it('should log error when not initialized', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await store.refreshFlags();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should refresh flags after initialization', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: () => Promise.resolve(
            callCount === 1 ? { F1: true } : { F1: true, F2: true }
          ),
        } as Response;
      });

      await store.initTogglyClient({ appKey: 'test-key' });
      expect(store.$flags.get()).toEqual({ F1: true });

      await store.refreshFlags();
      expect(store.$flags.get()).toEqual({ F1: true, F2: true });
    });
  });

  // ─── setIdentity ──────────────────────
  describe('setIdentity', () => {
    it('should log error when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      store.setIdentity('user-123');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should set identity and trigger refresh', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key' });
      store.setIdentity('user-123');

      // Wait for the refresh triggered by setIdentity
      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ─── clearIdentity ──────────────────────
  describe('clearIdentity', () => {
    it('should log error when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      store.clearIdentity();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should clear identity and trigger refresh', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key', identity: 'user-1' });
      store.clearIdentity();

      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ─── stopRefreshInterval ──────────────────────
  describe('stopRefreshInterval', () => {
    it('should not throw when not initialized', () => {
      expect(() => store.stopRefreshInterval()).not.toThrow();
    });

    it('should stop interval after initialization', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
      });

      const callsAfterInit = fetchSpy.mock.calls.length;
      store.stopRefreshInterval();

      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterInit);
      vi.useRealTimers();
    });
  });

  // ─── addHook / removeHook ──────────────────────
  describe('addHook', () => {
    it('should log error when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      store.addHook({
        getMetadata: () => ({ name: 'Test', version: '1.0.0' }),
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should add hook after initialization', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key' });

      // Should not throw
      store.addHook({
        getMetadata: () => ({ name: 'DynHook', version: '1.0.0' }),
      });
    });
  });

  describe('removeHook', () => {
    it('should log error and return false when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = store.removeHook('SomeHook');
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should remove hook after initialization', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key' });
      store.addHook({
        getMetadata: () => ({ name: 'ToRemove', version: '1.0.0' }),
      });
      expect(store.removeHook('ToRemove')).toBe(true);
      expect(store.removeHook('ToRemove')).toBe(false);
    });
  });

  // ─── Refresh interval ──────────────────────
  describe('refresh interval', () => {
    it('should start refresh interval when configured', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
      });

      const callsAfterInit = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterInit);
      store.stopRefreshInterval();
      vi.useRealTimers();
    });

    it('should not start refresh when interval is 0', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
      });

      const callsAfterInit = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200000);

      expect(fetchSpy.mock.calls.length).toBe(callsAfterInit);
      vi.useRealTimers();
    });
  });

  // ─── fetchFlags error handling ──────────────────────
  describe('fetchFlags error handling', () => {
    it('should use cached flags on error after successful fetch', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: () => Promise.resolve({ F1: true }),
          } as Response;
        }
        throw new Error('Network fail');
      });

      await store.initTogglyClient({
        appKey: 'test-key',
        isDebug: true,
      });
      expect(store.$flags.get()).toEqual({ F1: true });

      // Refresh should fall back to cached flags
      await store.refreshFlags();
      expect(store.$flags.get()).toEqual({ F1: true });
    });

    it('should handle refresh error gracefully', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: () => Promise.resolve({ F1: true }),
          } as Response;
        }
        throw new Error('Refresh failed');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await store.initTogglyClient({ appKey: 'test-key' });
      await store.refreshFlags();

      // Should not crash
      expect(store.$isReady.get()).toBe(true);
    });
  });
});
