import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Toggly, type TogglyOptions } from '../services/toggly.service';

const SDK_FETCH_OPTIONS = expect.objectContaining({
  headers: expect.objectContaining({
    'X-Toggly-Sdk': 'svelte',
    'X-Toggly-Sdk-Version': '1.4.1',
  }),
});

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
        ok: true,
        status: 200,
        statusText: 'OK',
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
      const config: TogglyOptions = { appKey: 'test-key' };
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
    let fetchSpy: any;

    beforeEach(() => {
      localStorage.clear();
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should load features from API', async () => {
      const toggly = new Toggly({ appKey: 'test-key', environment: 'Production' });
      const features = await toggly._loadFeatures();
      expect(features).toEqual({ F1: true, F2: false });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-signed/test-key/Production',
        SDK_FETCH_OPTIONS,
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
        'https://definitions.toggly.io/evaluated-signed/test-key/Staging?u=user-123',
        SDK_FETCH_OPTIONS,
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
        'https://custom.api.io/evaluated-signed/test-key/Dev',
        SDK_FETCH_OPTIONS,
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
        expect.stringContaining('Using cached/default features')
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
          ok: true,
          status: 200,
          statusText: 'OK',
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
        ok: true,
        status: 200,
        statusText: 'OK',
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

  // ─── Variants (enableVariants) ──────────────────────────
  describe('Variants (enableVariants)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('should fetch evaluated-variants-signed when enableVariants is true', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              V: { enabled: true, variant: 'A', configurationValue: { x: 1 } },
            },
          }),
      } as Response);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
      });

      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/test-key/Production',
        SDK_FETCH_OPTIONS,
      );
      expect(toggly.getVariant('V')).toEqual({ name: 'A', configurationValue: { x: 1 } });
      expect(toggly.getVariantValue('V')).toEqual({ x: 1 });
    });

    it('should pass userId query when enableVariants and identity are set', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ defs: {} }),
      } as Response);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toggly = new Toggly({
        appKey: 'k',
        environment: 'Production',
        enableVariants: true,
        identity: 'user@x',
      });

      await toggly._loadFeatures();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('userId=user%40x'),
        SDK_FETCH_OPTIONS,
      );
    });

    it('getVariant returns null when enableVariants is false', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toggly = new Toggly({
        featureDefaults: { F: true },
      });
      expect(toggly.getVariant('F')).toBeNull();
      expect(toggly.getVariantValue('F')).toBeNull();
      expect(toggly.getVariantDefinitions()).toBeNull();
    });

    it('should persist variants under toggly:variants cache key', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: { V: { enabled: true, variant: 'B' } },
          }),
      } as Response);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const appKey = 'cache-key';
      const env = 'Production';
      localStorage.removeItem(`toggly:variants:${appKey}:${env}`);

      const toggly = new Toggly({
        appKey,
        environment: env,
        enableVariants: true,
      });
      await toggly._loadFeatures();

      const raw = localStorage.getItem(`toggly:variants:${appKey}:${env}`);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual({ V: { enabled: true, variant: 'B' } });
    });

    it('falls back to cached variants on API error when enableVariants', async () => {
      const appKey = 'test-key';
      const env = 'Production';
      const defs = { V: { enabled: true, variant: 'cached' } };
      localStorage.setItem(`toggly:variants:${appKey}:${env}`, JSON.stringify(defs));
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toggly = new Toggly({
        appKey,
        environment: env,
        enableVariants: true,
      });
      await toggly._loadFeatures();

      expect(toggly.getVariant('V')).toEqual({ name: 'cached', configurationValue: undefined });
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

    it('should fail closed when features are empty and gate is non-empty', async () => {
      const emptyToggly = new Toggly({ featureDefaults: {} });
      const result = await emptyToggly._evaluateFeatureGate(['F1'], 'all', false);
      expect(result).toBe(false);
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
      const result = await toggly.isFeatureOn('F1');
      expect(result).toBe(false);
    });

    it('should use cached features on subsequent failed loads', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
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

  // ─── setContext ─────────────────────────────────
  describe('setContext', () => {
    it('should include groups and claims in API URL after setContext', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await toggly.refreshFlags();
      fetchSpy.mockClear();

      await toggly.setContext({
        identity: 'user-123',
        groups: ['beta'],
        claims: { role: 'admin' },
      });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('g=beta');
      expect(url).toContain('claim.role=admin');
    });

    it('setContext with empty identity clears identity', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await toggly.refreshFlags();
      fetchSpy.mockClear();

      await toggly.setContext({ identity: '' });

      expect((toggly as any)._config.identity).toBeUndefined();
    });

    it('setContext with empty groups omits g params on fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await toggly.refreshFlags();
      fetchSpy.mockClear();

      await toggly.setContext({ groups: [] });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).not.toContain('g=');
    });

    it('setContext with only claims forces refresh', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: false }),
      } as Response);

      const toggly = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await toggly.refreshFlags();
      fetchSpy.mockClear();

      await toggly.setContext({ claims: { role: 'admin' } });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('claim.role=admin');
      expect(await toggly.isFeatureOn('F1')).toBe(false);
    });
  });

  // ─── WebSocket live updates ───────────────────────
  describe('WebSocket live updates', () => {
    let mockWsInstances: any[];
    let fetchSpy: any;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockWsInstances = [];
      const MockWs = class {
        url: string;
        onopen: (() => void) | null = null;
        onmessage: ((e: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        closeCalled = false;
        constructor(url: string) {
          this.url = url;
          mockWsInstances.push(this);
        }
        close() { this.closeCalled = true; }
      };
      vi.stubGlobal('WebSocket', MockWs);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      } as Response);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('should not start WebSocket when no appKey', () => {
      const s = new Toggly({ featureDefaults: { F1: true } });
      s.startWebSocket();
      expect(mockWsInstances).toHaveLength(0);
    });

    it('should not start WebSocket when enableLiveUpdates is false', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod', enableLiveUpdates: false });
      s.startWebSocket();
      expect(mockWsInstances).toHaveLength(0);
    });

    it('should build wss:// URL from https:// baseURI', () => {
      const s = new Toggly({ appKey: 'mykey', environment: 'Prod' });
      s.startWebSocket();
      expect(mockWsInstances).toHaveLength(1);
      expect(mockWsInstances[0].url).toBe('wss://definitions.toggly.io/mykey/ws?sdk=svelte&sdkVersion=1.4.1');
    });

    it('should build ws:// URL from http:// baseURI', () => {
      const s = new Toggly({ appKey: 'mykey', baseURI: 'http://local.test', environment: 'Prod' });
      s.startWebSocket();
      expect(mockWsInstances[0].url).toBe('ws://local.test/mykey/ws?sdk=svelte&sdkVersion=1.4.1');
    });

    it('should set _wsConnected on onopen', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onopen!();
      expect(s._wsConnected).toBe(true);
    });

    it('should refresh features on JSON flags-updated message', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'flags-updated' }) });
      vi.advanceTimersByTime(350);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should refresh features on JSON update message', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'update' }) });
      vi.advanceTimersByTime(350);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should ignore JSON ping message', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'ping' }) });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should ignore unknown JSON message type', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'unknown' }) });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should refresh features on plain text "update"', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: 'update' });
      vi.advanceTimersByTime(350);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should refresh features on plain text "flags-updated"', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: 'flags-updated' });
      vi.advanceTimersByTime(350);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should ignore unrecognized plain text messages', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      fetchSpy.mockClear();
      mockWsInstances[0].onmessage!({ data: 'heartbeat' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should log error on onerror', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      const err = new Event('error');
      mockWsInstances[0].onerror!(err);
      expect(errSpy).toHaveBeenCalledWith('[Toggly] WebSocket error:', err);
    });

    it('should schedule reconnect on onclose', () => {
      vi.useFakeTimers();
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onclose!();
      expect(s._wsConnected).toBe(false);
      vi.runAllTimers();
      expect(mockWsInstances).toHaveLength(2);
    });

    it('should close WebSocket on stopWebSocket', () => {
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      const ws = mockWsInstances[0];
      s.stopWebSocket();
      expect(ws.closeCalled).toBe(true);
      expect(s._wsConnected).toBe(false);
    });

    it('should cancel reconnect timer on stopWebSocket', () => {
      vi.useFakeTimers();
      const s = new Toggly({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onclose!();
      expect(s._wsReconnectTimer).not.toBeNull();
      s.stopWebSocket();
      expect(s._wsReconnectTimer).toBeNull();
      vi.runAllTimers();
      expect(mockWsInstances).toHaveLength(1);
    });
  });
});
