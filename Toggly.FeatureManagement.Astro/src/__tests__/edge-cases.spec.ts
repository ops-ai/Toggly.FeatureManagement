import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type StoreModule = typeof import('../client/store.js');

describe('Edge Cases & Error Handling', () => {
  let store: StoreModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store = await import('../client/store.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Network Errors ──────────────────────
  describe('Network Errors', () => {
    it('should handle 404 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('Not Found')),
      } as any);

      await store.initTogglyClient({
        appKey: 'bad-key',
        flagDefaults: { F1: true },
      });

      expect(store.$flags.get()).toBeTruthy();
      expect(store.$isReady.get()).toBe(true);
    });

    it('should handle TypeError (network disconnect)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new TypeError('Failed to fetch')
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$flags.get()).toEqual({ F1: true });
      expect(store.$isReady.get()).toBe(true);
    });

    it('should handle AbortError (timeout)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('Aborted', 'AbortError')
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$flags.get()).toEqual({ F1: true });
    });
  });

  // ─── Invalid Data ──────────────────────
  describe('Invalid Data', () => {
    it('should handle malformed JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as any);

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$flags.get()).toBeTruthy();
      expect(store.$isReady.get()).toBe(true);
    });

    it('should handle null response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      } as any);

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$isReady.get()).toBe(true);
    });

    it('should handle empty object response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as any);

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$isReady.get()).toBe(true);
    });
  });

  // ─── Feature Flag Computed Atoms ──────────────────────
  describe('Feature Flag Computed Atoms', () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no net'));
      await store.initTogglyClient({
        flagDefaults: {
          '': true,
          'feature.with.dots': true,
          'feature/slashes': true,
          'UPPERCASE': true,
          'lowercase': false,
          '🚀emoji': true,
        },
      });
    });

    it('should handle empty string key via $flag', () => {
      const flagStore = store.$flag('');
      expect(flagStore.get()).toBe(true);
    });

    it('should handle keys with dots via $flag', () => {
      expect(store.$flag('feature.with.dots').get()).toBe(true);
    });

    it('should handle keys with slashes via $flag', () => {
      expect(store.$flag('feature/slashes').get()).toBe(true);
    });

    it('should be case-sensitive via $flag', () => {
      expect(store.$flag('UPPERCASE').get()).toBe(true);
      expect(store.$flag('uppercase').get()).toBe(false);
    });

    it('should handle emoji keys via $flag', () => {
      expect(store.$flag('🚀emoji').get()).toBe(true);
    });

    it('should return default for non-existent keys', () => {
      expect(store.$flag('does-not-exist').get()).toBe(false);
      expect(store.$flag('does-not-exist', true).get()).toBe(true);
    });
  });

  // ─── Gate Computed Atoms ──────────────────────
  describe('Gate Computed Atoms', () => {
    beforeEach(async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no net'));
      await store.initTogglyClient({
        flagDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should handle gate with all undefined features', () => {
      expect(store.$gate(['X1', 'X2'], 'all').get()).toBe(false);
    });

    it('should handle gate with duplicate keys', () => {
      expect(store.$gate(['F1', 'F1', 'F1'], 'all').get()).toBe(true);
    });

    it('should handle gate with mixed defined/undefined', () => {
      expect(store.$gate(['F1', 'Unknown'], 'all').get()).toBe(false);
    });

    it('should handle single-item gate', () => {
      expect(store.$gate(['F1'], 'all').get()).toBe(true);
    });

    it('should handle negate with all false', () => {
      expect(store.$gate(['F2'], 'any', true).get()).toBe(true);
    });

    it('should handle empty keys array', () => {
      expect(store.$gate([], 'all').get()).toBe(true);
    });
  });

  // ─── Configuration Edge Cases ──────────────────────
  describe('Configuration Edge Cases', () => {
    it('should handle no appKey and no defaults', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no net'));
      await store.initTogglyClient({});
      expect(store.$isReady.get()).toBe(true);
    });

    it('should warn on double initialization', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no net'));
      await store.initTogglyClient({ flagDefaults: { F1: true } });
      await store.initTogglyClient({ flagDefaults: { F2: true } });
      expect(console.warn).toHaveBeenCalled();
    });
  });

  // ─── Lifecycle ──────────────────────
  describe('Lifecycle', () => {
    it('should handle stopRefreshInterval before init', () => {
      expect(() => store.stopRefreshInterval()).not.toThrow();
    });

    it('should handle refreshFlags before init gracefully', async () => {
      await store.refreshFlags();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should handle setIdentity before init gracefully', () => {
      store.setIdentity('user-1');
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should handle clearIdentity before init gracefully', () => {
      store.clearIdentity();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });
  });

  // ─── Hook Edge Cases ──────────────────────
  describe('Hook Edge Cases', () => {
    const createTestHook = (name: string, overrides: any = {}) => ({
      getMetadata: () => ({ name }),
      ...overrides,
    });

    it('should handle addHook before init gracefully', () => {
      store.addHook(createTestHook('test') as any);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should handle removeHook before init gracefully', () => {
      expect(store.removeHook('test')).toBe(false);
    });

    it('should handle adding and removing hooks after init', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no net'));
      await store.initTogglyClient({ flagDefaults: { F1: true } });

      store.addHook(createTestHook('dynamic-hook') as any);
      expect(store.removeHook('dynamic-hook')).toBe(true);
      expect(store.removeHook('non-existent')).toBe(false);
    });
  });

  // ─── Memory Leak Prevention ──────────────────────
  describe('Memory Leak Prevention', () => {
    it('should handle interval cleanup via stopRefreshInterval', async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as any);

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
      });

      store.stopRefreshInterval();
      await vi.advanceTimersByTimeAsync(10000);

      vi.useRealTimers();
    });
  });
});
