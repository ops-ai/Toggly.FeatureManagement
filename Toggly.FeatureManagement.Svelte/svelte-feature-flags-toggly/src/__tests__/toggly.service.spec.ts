import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Toggly } from '../services/toggly.service';

describe('Toggly Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constructor Warnings ──────────────────────
  describe('Constructor warnings', () => {
    it('should warn when no appKey and no featureDefaults', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      new Toggly({});
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('A valid application key is required')
      );
    });

    it('should warn when no appKey but featureDefaults provided', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      new Toggly({ featureDefaults: { F1: true } });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults')
      );
    });

    it('should warn when appKey provided but no environment', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ F1: true }),
      } as Response);
      const toggly = new Toggly({ appKey: 'test-key' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using Production environment')
      );
    });

    it('should not warn when appKey and environment provided', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      new Toggly({ appKey: 'test-key', environment: 'Staging' });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should set features from featureDefaults when no appKey', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({ featureDefaults: { F1: true, F2: false } });
      // Features should be set directly from defaults
      expect((toggly as any)._features).toEqual({ F1: true, F2: false });
    });

    it('should default environment to Production when appKey provided without environment', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = { appKey: 'test-key' };
      new Toggly(config);
      expect(config.environment).toBe('Production');
    });
  });

  // ─── shouldShowFeatureDuringEvaluation ──────────
  describe('shouldShowFeatureDuringEvaluation', () => {
    it('should default to false', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({ featureDefaults: { F1: true } });
      expect(toggly.shouldShowFeatureDuringEvaluation).toBe(false);
    });

    it('should use provided value', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({
        featureDefaults: { F1: true },
        showFeatureDuringEvaluation: true,
      });
      expect(toggly.shouldShowFeatureDuringEvaluation).toBe(true);
    });
  });

  // ─── Feature Loading ──────────────────────────
  describe('Feature Loading', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should load features from API', async () => {
      const toggly = new Toggly({ appKey: 'test-key', environment: 'Production' });
      const features = await toggly._loadFeatures();
      expect(features).toEqual({ F1: true, F2: false });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://client.toggly.io/test-key-Production/defs'
      );
    });

    it('should include identity in URL when provided', async () => {
      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Staging',
        identity: 'user-123',
      });
      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://client.toggly.io/test-key-Staging/defs?u=user-123'
      );
    });

    it('should use custom baseURI', async () => {
      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Dev',
        baseURI: 'https://custom.api.io',
      });
      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://custom.api.io/test-key-Dev/defs'
      );
    });

    it('should return cached features within refresh interval', async () => {
      const toggly = new Toggly({ appKey: 'test-key', environment: 'Production' });
      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const features = await toggly._loadFeatures();
      expect(features).toEqual({ F1: true, F2: false });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle fetch errors by using defaults', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        featureDefaults: { F1: false },
      });
      const features = await toggly._loadFeatures();
      expect(features).toEqual({ F1: false });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults or cached')
      );
    });

    it('should handle fetch errors with empty defaults when no featureDefaults', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });
      const features = await toggly._loadFeatures();
      expect(features).toEqual({});
    });

    it('should not duplicate API calls during concurrent loading', async () => {
      let resolveFirst!: (v: any) => void;
      const slowPromise = new Promise((r) => { resolveFirst = r; });
      fetchSpy.mockReturnValue(
        slowPromise.then(() => ({
          json: () => Promise.resolve({ F1: true }),
        })) as any
      );

      const toggly = new Toggly({ appKey: 'test-key', environment: 'Production' });

      // Start two concurrent loads
      const load1 = toggly._loadFeatures();
      const load2 = toggly._loadFeatures();

      // Resolve the first
      resolveFirst(undefined);
      const [r1, r2] = await Promise.all([load1, load2]);

      expect(r1).toEqual({ F1: true });
      expect(r2).toEqual({ F1: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should use _featuresLoaded to return cached or load', async () => {
      const toggly = new Toggly({ appKey: 'test-key', environment: 'Production' });
      const features = await toggly._featuresLoaded();
      expect(features).toEqual({ F1: true, F2: false });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should return cached features from _featuresLoaded without loading again', async () => {
      const toggly = new Toggly({
        featureDefaults: { F1: true },
      });
      const features = await toggly._featuresLoaded();
      expect(features).toEqual({ F1: true });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should trigger afterRefresh hooks after loading', async () => {
      let refreshCalled = false;
      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        hooks: [{
          getMetadata: () => ({ name: 'RefreshHook', version: '1.0.0' }),
          afterRefresh: async () => { refreshCalled = true; },
        }],
      });
      await toggly._loadFeatures();
      expect(refreshCalled).toBe(true);
    });
  });

  // ─── refreshFlags ──────────────────────────
  describe('refreshFlags', () => {
    it('should force refresh by resetting lastFetchTime', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ F1: true }),
      } as Response);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toggly = new Toggly({ appKey: 'test-key', environment: 'Production' });
      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Call refreshFlags to force reload
      await toggly.refreshFlags();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Feature Evaluation ──────────────────────
  describe('Feature Evaluation', () => {
    let toggly: Toggly;

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      toggly = new Toggly({
        featureDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should evaluate single feature on', async () => {
      const result = await toggly.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should evaluate single feature off', async () => {
      const result = await toggly.isFeatureOn('F2');
      expect(result).toBe(false);
    });

    it('should evaluate isFeatureOff correctly', async () => {
      const result = await toggly.isFeatureOff('F2');
      expect(result).toBe(true);
    });

    it('should evaluate isFeatureOff for enabled feature', async () => {
      const result = await toggly.isFeatureOff('F1');
      expect(result).toBe(false);
    });

    it('should evaluate unknown feature as falsy', async () => {
      const result = await toggly.isFeatureOn('Unknown');
      expect(result).toBeFalsy();
    });

    it('should return true when features are empty', async () => {
      const emptyToggly = new Toggly({ featureDefaults: {} });
      const result = await emptyToggly._evaluateFeatureGate(['F1'], 'all', false);
      expect(result).toBe(true);
    });
  });

  // ─── evaluateFeatureGate ──────────────────────
  describe('evaluateFeatureGate', () => {
    let toggly: Toggly;

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      toggly = new Toggly({
        featureDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should evaluate "all" requirement with all enabled', async () => {
      const result = await toggly.evaluateFeatureGate(['F1', 'F3'], 'all', false);
      expect(result).toBe(true);
    });

    it('should evaluate "all" requirement with some disabled', async () => {
      const result = await toggly.evaluateFeatureGate(['F1', 'F2'], 'all', false);
      expect(result).toBeFalsy();
    });

    it('should evaluate "any" requirement with some enabled', async () => {
      const result = await toggly.evaluateFeatureGate(['F1', 'F2'], 'any', false);
      expect(result).toBe(true);
    });

    it('should evaluate "any" requirement with none enabled', async () => {
      const result = await toggly.evaluateFeatureGate(['F2'], 'any', false);
      expect(result).toBe(false);
    });

    it('should support negate', async () => {
      const result = await toggly.evaluateFeatureGate(['F1'], 'all', true);
      expect(result).toBe(false);
    });

    it('should negate false to true', async () => {
      const result = await toggly.evaluateFeatureGate(['F2'], 'all', true);
      expect(result).toBe(true);
    });

    it('should handle empty gate array (via evaluateFeatureGate)', async () => {
      const result = await toggly.evaluateFeatureGate([], 'all', false);
      expect(result).toBe(true);
    });

    it('should call hooks for gate evaluation with keys', async () => {
      let hookCalled = false;
      toggly.addHook({
        getMetadata: () => ({ name: 'GateHook', version: '1.0.0' }),
        beforeEvaluation: async () => { hookCalled = true; },
      });
      await toggly.evaluateFeatureGate(['F1'], 'all', false);
      expect(hookCalled).toBe(true);
    });

    it('should skip hooks for empty gate array', async () => {
      let hookCalled = false;
      toggly.addHook({
        getMetadata: () => ({ name: 'GateHook2', version: '1.0.0' }),
        beforeEvaluation: async () => { hookCalled = true; },
      });
      await toggly.evaluateFeatureGate([], 'all', false);
      expect(hookCalled).toBe(false);
    });
  });

  // ─── Hook Registration ──────────────────────
  describe('Hook Management', () => {
    it('should register hooks from config', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let hookCalled = false;
      const toggly = new Toggly({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'ConfigHook', version: '1.0.0' }),
          beforeEvaluation: async () => { hookCalled = true; },
        }],
      });
      await toggly.isFeatureOn('F1');
      expect(hookCalled).toBe(true);
    });

    it('should add hook dynamically', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let hookCalled = false;
      const toggly = new Toggly({ featureDefaults: { F1: true } });
      toggly.addHook({
        getMetadata: () => ({ name: 'DynHook', version: '1.0.0' }),
        beforeEvaluation: async () => { hookCalled = true; },
      });
      await toggly.isFeatureOn('F1');
      expect(hookCalled).toBe(true);
    });

    it('should remove hook by name', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let callCount = 0;
      const toggly = new Toggly({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'RemovableHook', version: '1.0.0' }),
          beforeEvaluation: async () => { callCount++; },
        }],
      });
      await toggly.isFeatureOn('F1');
      expect(callCount).toBe(1);

      const removed = toggly.removeHook('RemovableHook');
      expect(removed).toBe(true);

      await toggly.isFeatureOn('F1');
      expect(callCount).toBe(1);
    });

    it('should return false when removing non-existent hook', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({ featureDefaults: { F1: true } });
      expect(toggly.removeHook('NonExistent')).toBe(false);
    });
  });

  // ─── Edge Cases ──────────────────────
  describe('Edge Cases', () => {
    it('should handle null features after failed load', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'));
      const toggly = new Toggly({ appKey: 'test-key', environment: 'Prod' });
      await toggly._loadFeatures();
      // Features default to {} when no featureDefaults
      const result = await toggly.isFeatureOn('F1');
      expect(result).toBe(true); // empty features returns true
    });

    it('should use cached features on subsequent failed loads', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ F1: true }),
        } as Response)
        .mockRejectedValueOnce(new Error('fail'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toggly = new Toggly({ appKey: 'test-key', environment: 'Prod' });
      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Force refresh and fail
      await toggly.refreshFlags();
      // Should still have cached features
      const result = await toggly.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle config with no hooks array', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({ featureDefaults: { F1: true } });
      // Should not throw
      expect(toggly).toBeTruthy();
    });
  });
});
