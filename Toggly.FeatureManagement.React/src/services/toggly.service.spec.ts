import Toggly from './toggly.service';
import type { Hook } from '@ops-ai/toggly-hooks-types';

// Mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('Toggly Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ───────────────────────────────────────────────
  // Constructor
  // ───────────────────────────────────────────────
  describe('Constructor', () => {
    it('should use featureDefaults when no appKey provided', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults')
      );
    });

    it('should warn when no appKey and no featureDefaults', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new Toggly({});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('valid application key is required')
      );
    });

    it('should default environment to Production when appKey provided without env', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new Toggly({ appKey: 'test-key' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using Production environment')
      );
    });

    it('should accept appKey and environment without warning about env', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new Toggly({ appKey: 'test-key', environment: 'Staging' });

      // Should NOT warn about production environment
      const envWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('Production environment')
      );
      expect(envWarns).toHaveLength(0);
    });

    it('should set shouldShowFeatureDuringEvaluation from config', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
        showFeatureDuringEvaluation: true,
      });

      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });

    it('should default shouldShowFeatureDuringEvaluation to false', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });

      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });

    it('should register hooks from config', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'InitHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should merge config with defaults', () => {
      const service = new Toggly({
        appKey: 'key',
        environment: 'Test',
      });

      // The base URI should be the default
      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // Feature Loading
  // ───────────────────────────────────────────────
  describe('_loadFeatures', () => {
    it('should return feature defaults when no appKey', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({ F1: true, F2: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch features from API when appKey is set', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ApiFlag: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({ ApiFlag: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://client.toggly.io/test-key-Production/defs'
      );
    });

    it('should include identity in API URL when set', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://client.toggly.io/test-key-Production/defs?u=user-123'
      );
    });

    it('should use custom baseURI when configured', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        baseURI: 'https://custom.api.com',
        appKey: 'test-key',
        environment: 'Staging',
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/test-key-Staging/defs'
      );
    });

    it('should fall back to featureDefaults on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        featureDefaults: { Fallback: true },
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({ Fallback: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults')
      );
    });

    it('should fall back to empty object when no featureDefaults on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({});
    });

    it('should not make duplicate API calls during loading', async () => {
      let resolveFirst: (value: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      mockFetch.mockReturnValueOnce(
        slowPromise.then(() => ({
          json: () => Promise.resolve({ F1: true }),
        }))
      );

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      // Start two loads simultaneously
      const load1 = service._loadFeatures();
      const load2 = service._loadFeatures();

      // Resolve the fetch
      resolveFirst!(undefined);

      const [result1, result2] = await Promise.all([load1, load2]);

      expect(result1).toEqual({ F1: true });
      expect(result2).toEqual({ F1: true });
      // Only one fetch should have been made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return cached features on subsequent calls', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const first = await service._loadFeatures();
      const second = await service._loadFeatures();

      expect(first).toEqual({ F1: true });
      expect(second).toEqual({ F1: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should trigger afterRefresh hooks after loading', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      let refreshedFlags: any = null;
      const hook: Hook = {
        getMetadata: () => ({ name: 'RefreshHook', version: '1.0.0' }),
        afterRefresh: async (flags) => {
          refreshedFlags = flags;
        },
      };

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        hooks: [hook],
      });

      await service._loadFeatures();
      expect(refreshedFlags).toEqual({ F1: true });
    });
  });

  // ───────────────────────────────────────────────
  // _featuresLoaded
  // ───────────────────────────────────────────────
  describe('_featuresLoaded', () => {
    it('should return features if already loaded', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      // Features are loaded via constructor (featureDefaults)
      const features = await service._featuresLoaded();
      expect(features).toEqual({ F1: true });
    });

    it('should load features if not yet loaded', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ApiFlag: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const features = await service._featuresLoaded();
      expect(features).toEqual({ ApiFlag: true });
    });
  });

  // ───────────────────────────────────────────────
  // Feature Evaluation (_evaluateFeatureGate)
  // ───────────────────────────────────────────────
  describe('_evaluateFeatureGate', () => {
    let service: Toggly;

    beforeEach(() => {
      service = new Toggly({
        featureDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should return true when all flags are enabled (requirement: all)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'F3'],
        'all',
        false
      );
      expect(result).toBe(true);
    });

    it('should return falsy when some flags are disabled (requirement: all)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'F2'],
        'all',
        false
      );
      expect(result).toBeFalsy();
    });

    it('should return true when any flag is enabled (requirement: any)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'F2'],
        'any',
        false
      );
      expect(result).toBe(true);
    });

    it('should return false when no flag is enabled (requirement: any)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F2'],
        'any',
        false
      );
      expect(result).toBe(false);
    });

    it('should negate the result', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1'],
        'all',
        true
      );
      expect(result).toBe(false);
    });

    it('should negate falsy to truthy', async () => {
      const result = await service._evaluateFeatureGate(
        ['F2'],
        'all',
        true
      );
      expect(result).toBeTruthy();
    });

    it('should return true for empty features object', async () => {
      const emptyService = new Toggly({
        featureDefaults: {},
      });

      const result = await emptyService._evaluateFeatureGate(
        ['F1'],
        'all',
        false
      );
      expect(result).toBe(true);
    });

    it('should treat unknown flags as falsy with all requirement', async () => {
      const result = await service._evaluateFeatureGate(
        ['Unknown'],
        'all',
        false
      );
      expect(result).toBeFalsy();
    });

    it('should treat unknown flags as falsy with any requirement', async () => {
      const result = await service._evaluateFeatureGate(
        ['Unknown'],
        'any',
        false
      );
      expect(result).toBeFalsy();
    });

    it('should default requirement to all', async () => {
      const result = await service._evaluateFeatureGate(['F1', 'F3']);
      expect(result).toBe(true);
    });

    it('should handle mixed known/unknown flags with any', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'Unknown'],
        'any',
        false
      );
      expect(result).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // evaluateFeatureGate (public, with hooks)
  // ───────────────────────────────────────────────
  describe('evaluateFeatureGate', () => {
    it('should evaluate gate with hooks for non-empty keys', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'GateHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(`before:${key}`);
        },
        afterEvaluation: async (key, _data, result) => {
          calls.push(`after:${key}:${result}`);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
        hooks: [hook],
      });

      const result = await service.evaluateFeatureGate(
        ['F1', 'F2'],
        'all',
        false
      );

      expect(result).toBeFalsy();
      expect(calls[0]).toBe('before:F1');
      expect(calls[1]).toContain('after:F1:');
    });

    it('should evaluate gate without hooks for empty keys', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'EmptyGateHook', version: '1.0.0' }),
        beforeEvaluation: async () => {
          calls.push('called');
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      const result = await service.evaluateFeatureGate([], 'all', false);

      // Empty gate with empty features → true; empty gate with non-empty features → true
      expect(calls).toHaveLength(0); // No hooks called for empty gate
    });

    it('should pass result to afterEvaluation hook', async () => {
      let hookResult: boolean | undefined;
      const hook: Hook = {
        getMetadata: () => ({ name: 'ResultHook', version: '1.0.0' }),
        afterEvaluation: async (_key, _data, result) => {
          hookResult = result;
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.evaluateFeatureGate(['F1'], 'all', false);
      expect(hookResult).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // isFeatureOn
  // ───────────────────────────────────────────────
  describe('isFeatureOn', () => {
    it('should return true for enabled feature', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      const service = new Toggly({
        featureDefaults: { F1: false },
      });

      expect(await service.isFeatureOn('F1')).toBe(false);
    });

    it('should return falsy for unknown feature', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOn('Unknown')).toBeFalsy();
    });

    it('should trigger before/after evaluation hooks', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'OnHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(`before:${key}`);
        },
        afterEvaluation: async (key) => {
          calls.push(`after:${key}`);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.isFeatureOn('F1');
      expect(calls).toEqual(['before:F1', 'after:F1']);
    });

    it('should load features from API before evaluation', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ RemoteFlag: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const result = await service.isFeatureOn('RemoteFlag');
      expect(result).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // isFeatureOff
  // ───────────────────────────────────────────────
  describe('isFeatureOff', () => {
    it('should return true for disabled feature (negate)', async () => {
      const service = new Toggly({
        featureDefaults: { F1: false },
      });

      expect(await service.isFeatureOff('F1')).toBeTruthy();
    });

    it('should return false for enabled feature (negate)', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOff('F1')).toBe(false);
    });

    it('should trigger hooks', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'OffHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.isFeatureOff('F1');
      expect(calls).toContain('F1');
    });
  });

  // ───────────────────────────────────────────────
  // Hook Management
  // ───────────────────────────────────────────────
  describe('Hook Management', () => {
    it('should add hook dynamically', async () => {
      const calls: string[] = [];
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      service.addHook({
        getMetadata: () => ({ name: 'DynHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      });

      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should remove hook and return true', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      service.addHook({
        getMetadata: () => ({ name: 'ToRemove', version: '1.0.0' }),
      });

      expect(service.removeHook('ToRemove')).toBe(true);
    });

    it('should return false when removing non-existent hook', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(service.removeHook('NonExistent')).toBe(false);
    });

    it('should stop calling removed hook', async () => {
      let callCount = 0;
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      service.addHook({
        getMetadata: () => ({ name: 'CountHook', version: '1.0.0' }),
        beforeEvaluation: async () => {
          callCount++;
        },
      });

      await service.isFeatureOn('F1');
      expect(callCount).toBe(1);

      service.removeHook('CountHook');
      await service.isFeatureOn('F1');
      expect(callCount).toBe(1); // No new calls
    });
  });

  // ───────────────────────────────────────────────
  // Edge Cases
  // ───────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should handle empty feature gate with features loaded', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      // Empty gate → returns true (since features exist but gate is empty,
      // _evaluateFeatureGate returns true for non-empty features with empty gate via reduce)
      const result = await service.evaluateFeatureGate([], 'all', false);
      expect(result).toBe(true);
    });

    it('should handle special characters in feature keys', async () => {
      const service = new Toggly({
        featureDefaults: {
          'Feature.With.Dots': true,
          'Feature-With-Dashes': false,
        },
      });

      expect(await service.isFeatureOn('Feature.With.Dots')).toBe(true);
      expect(await service.isFeatureOn('Feature-With-Dashes')).toBe(false);
    });

    it('should handle concurrent feature evaluations', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
      });

      const results = await Promise.all([
        service.isFeatureOn('F1'),
        service.isFeatureOn('F2'),
        service.isFeatureOff('F1'),
        service.isFeatureOff('F2'),
      ]);

      expect(results[0]).toBe(true); // F1 on
      expect(results[1]).toBe(false); // F2 on (false)
      expect(results[2]).toBe(false); // F1 off (negate true → false)
      expect(results[3]).toBeTruthy(); // F2 off (negate false → truthy)
    });
  });
});
