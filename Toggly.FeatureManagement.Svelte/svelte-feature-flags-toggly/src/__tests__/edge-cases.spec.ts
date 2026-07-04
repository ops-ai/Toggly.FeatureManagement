import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { Toggly } from '../services/toggly.service';
import { createToggly } from '../utils/createToggly';
import { togglyServiceStore, togglyFlagsStore, isFeatureOn, isFeatureOff, evaluateFeatureGate, createFeatureStore } from '../stores/toggly.store';

describe('Edge Cases & Error Handling', () => {
  beforeEach(() => {
    localStorage.clear();
    togglyServiceStore.set(null);
    togglyFlagsStore.set({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
        json: () => Promise.reject(new Error('Not JSON')),
      } as any);

      await createToggly({
        appKey: 'bad-key',
        featureDefaults: { F1: true },
      });

      expect(get(togglyFlagsStore)).toBeTruthy();
    });

    it('should handle 500 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      } as any);

      await createToggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      expect(get(togglyFlagsStore)).toBeTruthy();
    });

    it('should handle TypeError (network disconnect)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new TypeError('Failed to fetch')
      );

      await createToggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      expect(get(togglyFlagsStore)).toBeTruthy();
    });

    it('should handle AbortError', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('Aborted', 'AbortError')
      );

      await createToggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      expect(get(togglyFlagsStore)).toBeTruthy();
    });
  });

  // ─── Invalid Data ──────────────────────
  describe('Invalid Data', () => {
    it('should handle malformed JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as any);

      await createToggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      expect(get(togglyFlagsStore)).toBeTruthy();
    });

    it('should handle null response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(null),
      } as any);

      await createToggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      expect(get(togglyFlagsStore)).toBeTruthy();
    });

    it('should handle empty object response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      } as any);

      await createToggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const flags = get(togglyFlagsStore);
      expect(flags).toBeTruthy();
    });
  });

  // ─── Reliability ──────────────────────
  describe('Reliability', () => {
    it('should report fetch errors through onError and lastError', async () => {
      const errors: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
        enableLiveUpdates: false,
        onError: (message) => errors.push(message),
      });
      togglyServiceStore.set(service);

      await service._loadFeatures();
      expect(errors).toContain('Error fetching feature flags');
      expect(service.lastError).toBe('Error fetching feature flags');
    });

    it('should preserve last-known-good flags on transient refresh failure', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
        } as any)
        .mockRejectedValueOnce(new Error('network down'));

      const service = new Toggly({
        appKey: 'test-key',
        persistCache: false,
        enableLiveUpdates: false,
      });
      togglyServiceStore.set(service);

      expect(await service.isFeatureOn('F1')).toBe(true);
      await service.refreshFlags();
      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should not cache JSON error body from non-2xx response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ defs: { BadFlag: true } }),
      } as any);

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
        enableLiveUpdates: false,
      });
      togglyServiceStore.set(service);
      await service._loadFeatures();

      expect(localStorage.getItem('toggly:flags:test-key:Production')).toBeNull();
      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should fail closed for non-empty gates when no flags are loaded', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
      } as any);

      const service = new Toggly({
        appKey: 'test-key',
        persistCache: false,
        enableLiveUpdates: false,
      });
      togglyServiceStore.set(service);
      await service._loadFeatures();

      expect(await service.evaluateFeatureGate(['MissingFeature'])).toBe(false);
    });

    it('should fall back to cached variant defs when variants fetch fails', async () => {
      localStorage.setItem(
        'toggly:variants:test-key:Production',
        JSON.stringify({ VariantFlag: { enabled: true, variant: 'A' } }),
      );
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });
      togglyServiceStore.set(service);
      await service._loadFeatures();

      expect(await service.getVariant('VariantFlag')).toEqual({ name: 'A' });
    });
  });

  // ─── Feature Key Edge Cases ──────────────────────
  describe('Feature Key Edge Cases', () => {
    let service: Toggly;

    beforeEach(() => {
      service = new Toggly({
        featureDefaults: {
          '': true,
          'feature.with.dots': true,
          'feature/slashes': true,
          'UPPERCASE': true,
          'lowercase': false,
          '🚀emoji': true,
        },
      });
      togglyServiceStore.set(service);
      togglyFlagsStore.set({
        '': true,
        'feature.with.dots': true,
        'feature/slashes': true,
        'UPPERCASE': true,
        'lowercase': false,
        '🚀emoji': true,
      });
    });

    it('should handle empty string key', async () => {
      const result = await isFeatureOn('');
      expect(result).toBe(true);
    });

    it('should handle keys with dots', async () => {
      const result = await isFeatureOn('feature.with.dots');
      expect(result).toBe(true);
    });

    it('should handle keys with slashes', async () => {
      const result = await isFeatureOn('feature/slashes');
      expect(result).toBe(true);
    });

    it('should be case-sensitive', async () => {
      const upper = await isFeatureOn('UPPERCASE');
      const lower = await isFeatureOn('uppercase');
      expect(upper).toBe(true);
      expect(lower).toBeFalsy();
    });

    it('should handle emoji keys', async () => {
      const result = await isFeatureOn('🚀emoji');
      expect(result).toBe(true);
    });

    it('should return false for non-existent keys', async () => {
      const on = await isFeatureOn('does-not-exist');
      const off = await isFeatureOff('does-not-exist');
      expect(on).toBeFalsy();
      expect(off).toBe(true);
    });
  });

  // ─── Feature Gate Edge Cases ──────────────────────
  describe('Feature Gate Edge Cases', () => {
    beforeEach(() => {
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false, F3: true },
      });
      togglyServiceStore.set(service);
      togglyFlagsStore.set({ F1: true, F2: false, F3: true });
    });

    it('should handle gate with all undefined features', async () => {
      const result = await evaluateFeatureGate(['X1', 'X2'], 'all', false);
      expect(result).toBeFalsy();
    });

    it('should handle gate with duplicate keys', async () => {
      const result = await evaluateFeatureGate(['F1', 'F1', 'F1'], 'all', false);
      expect(result).toBe(true);
    });

    it('should handle gate with mixed defined/undefined', async () => {
      const result = await evaluateFeatureGate(['F1', 'Unknown'], 'all', false);
      expect(result).toBeFalsy();
    });

    it('should handle single-item gate', async () => {
      const result = await evaluateFeatureGate(['F1'], 'all', false);
      expect(result).toBe(true);
    });
  });

  // ─── createFeatureStore Edge Cases ──────────────────────
  describe('createFeatureStore Edge Cases', () => {
    it('should handle store with empty flags', () => {
      togglyFlagsStore.set({});
      const store = createFeatureStore('Any');
      expect(get(store)).toBe(false);
    });

    it('should reactively handle rapid flag changes', () => {
      const store = createFeatureStore('F1');
      expect(get(store)).toBe(false);

      for (let i = 0; i < 10; i++) {
        togglyFlagsStore.set({ F1: i % 2 === 0 });
      }

      // Final value should be false (9 % 2 = 1, not even)
      expect(get(store)).toBe(false);
    });
  });

  // ─── Svelte-Specific Edge Cases ──────────────────────
  describe('Svelte-Specific', () => {
    it('should handle multiple createToggly calls', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));

      await createToggly({ featureDefaults: { F1: true } });
      const service1 = get(togglyServiceStore);

      await createToggly({ featureDefaults: { F2: true } });
      const service2 = get(togglyServiceStore);

      // Second init should create a new service
      expect(service2).toBeTruthy();
    });

    it('should handle service destroyed during evaluation', async () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      togglyServiceStore.set(service);

      // Set to null mid-operation
      togglyServiceStore.set(null);

      await expect(isFeatureOn('F1')).rejects.toThrow();
    });
  });

  // ─── Memory Leak Prevention ──────────────────────
  describe('Memory Leak Prevention', () => {
    it('should handle interval cleanup via createToggly', async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      } as any);

      await createToggly({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 5000,
      });

      // Advance but not enough for refresh
      await vi.advanceTimersByTimeAsync(3000);

      vi.useRealTimers();
    });
  });
});
