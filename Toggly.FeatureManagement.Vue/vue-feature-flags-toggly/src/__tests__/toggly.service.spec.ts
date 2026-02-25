import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toggly } from '../plugins/toggly.service';
import type { Hook } from '@ops-ai/toggly-hooks-types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Toggly Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Init ─────────────────────────────────────
  describe('init', () => {
    it('should use featureDefaults when no appKey', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults')
      );
    });

    it('should warn when no appKey and no featureDefaults', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('valid application key is required')
      );
    });

    it('should default environment to Production when appKey set', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({ appKey: 'key' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using Production environment')
      );
    });

    it('should accept appKey and environment without production warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Staging' });

      const envWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('Production environment')
      );
      expect(envWarns).toHaveLength(0);
    });

    it('should set shouldShowFeatureDuringEvaluation', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true }, showFeatureDuringEvaluation: true });
      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });

    it('should default shouldShowFeatureDuringEvaluation to false', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });

    it('should return this for chaining', () => {
      const service = new Toggly();
      const result = service.init({ featureDefaults: { F1: true } });
      expect(result).toBe(service);
    });

    it('should register hooks from config', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'InitHook', version: '1.0.0' }),
          beforeEvaluation: async (key) => { calls.push(key); },
        }],
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });
  });

  // ─── Feature Loading ──────────────────────────
  describe('_loadFeatures', () => {
    it('should return defaults when no appKey', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      const features = await service._loadFeatures();
      expect(features).toEqual({ F1: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch from API when appKey set', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ ApiFlag: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const features = await service._loadFeatures();
      expect(features).toEqual({ ApiFlag: true });
      expect(mockFetch).toHaveBeenCalledWith('https://definitions.toggly.io/evaluated-signed/key/Production');
    });

    it('should include identity in API URL', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production', identity: 'user-1' });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-signed/key/Production?u=user-1'
      );
    });

    it('should use custom baseURI', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({ baseURI: 'https://custom.api', appKey: 'key', environment: 'Staging' });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith('https://custom.api/evaluated-signed/key/Staging');
    });

    it('should fall back to featureDefaults on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production', featureDefaults: { Fallback: true } });

      const features = await service._loadFeatures();
      expect(features).toEqual({ Fallback: true });
    });

    it('should fall back to empty object when no defaults', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const features = await service._loadFeatures();
      expect(features).toEqual({});
    });

    it('should not duplicate API calls during loading', async () => {
      let resolveFirst: (v: any) => void;
      const slowPromise = new Promise((r) => { resolveFirst = r; });

      mockFetch.mockReturnValueOnce(
        slowPromise.then(() => ({ json: () => Promise.resolve({ F1: true }) }))
      );

      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const load1 = service._loadFeatures();
      const load2 = service._loadFeatures();
      resolveFirst!(undefined);

      const [r1, r2] = await Promise.all([load1, load2]);
      expect(r1).toEqual({ F1: true });
      expect(r2).toEqual({ F1: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cache features after first load', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      await service._loadFeatures();
      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should trigger afterRefresh hooks', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ F1: true }) });
      let refreshed: any = null;
      const service = new Toggly();
      service.init({
        appKey: 'key', environment: 'Production',
        hooks: [{
          getMetadata: () => ({ name: 'RefHook', version: '1.0.0' }),
          afterRefresh: async (flags) => { refreshed = flags; },
        }],
      });

      await service._loadFeatures();
      expect(refreshed).toEqual({ F1: true });
    });
  });

  // ─── _featuresLoaded ──────────────────────────
  describe('_featuresLoaded', () => {
    it('should return features if already loaded', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      const features = await service._featuresLoaded();
      expect(features).toEqual({ F1: true });
    });

    it('should load features if not yet loaded', async () => {
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ ApiFlag: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const features = await service._featuresLoaded();
      expect(features).toEqual({ ApiFlag: true });
    });
  });

  // ─── _evaluateFeatureGate ─────────────────────
  describe('_evaluateFeatureGate', () => {
    let service: Toggly;

    beforeEach(() => {
      service = new Toggly();
      service.init({ featureDefaults: { F1: true, F2: false, F3: true } });
    });

    it('should return true when all flags enabled (requirement: all)', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F3'], 'all', false)).toBe(true);
    });

    it('should return falsy when some disabled (requirement: all)', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F2'], 'all', false)).toBeFalsy();
    });

    it('should return true when any enabled (requirement: any)', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F2'], 'any', false)).toBe(true);
    });

    it('should return falsy when none enabled (requirement: any)', async () => {
      expect(await service._evaluateFeatureGate(['F2'], 'any', false)).toBeFalsy();
    });

    it('should negate result', async () => {
      expect(await service._evaluateFeatureGate(['F1'], 'all', true)).toBe(false);
    });

    it('should return true for empty features', async () => {
      const empty = new Toggly();
      empty.init({ featureDefaults: {} });
      expect(await empty._evaluateFeatureGate(['F1'], 'all', false)).toBe(true);
    });

    it('should default requirement to all', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F3'])).toBe(true);
    });
  });

  // ─── evaluateFeatureGate (public) ─────────────
  describe('evaluateFeatureGate', () => {
    it('should call hooks for non-empty gate', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'GH', version: '1.0.0' }),
          beforeEvaluation: async (key) => { calls.push(`before:${key}`); },
          afterEvaluation: async (key) => { calls.push(`after:${key}`); },
        }],
      });

      await service.evaluateFeatureGate(['F1'], 'all', false);
      expect(calls).toEqual(['before:F1', 'after:F1']);
    });

    it('should skip hooks for empty gate', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'EH', version: '1.0.0' }),
          beforeEvaluation: async () => { calls.push('called'); },
        }],
      });

      await service.evaluateFeatureGate([], 'all', false);
      expect(calls).toHaveLength(0);
    });
  });

  // ─── isFeatureOn / isFeatureOff ───────────────
  describe('isFeatureOn', () => {
    it('should return true for enabled feature', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: false } });
      expect(await service.isFeatureOn('F1')).toBe(false);
    });

    it('should trigger hooks', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'OnH', version: '1.0.0' }),
          beforeEvaluation: async (k) => { calls.push(k); },
        }],
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });
  });

  describe('isFeatureOff', () => {
    it('should return truthy for disabled feature (negated)', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: false } });
      expect(await service.isFeatureOff('F1')).toBeTruthy();
    });

    it('should return false for enabled feature (negated)', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(await service.isFeatureOff('F1')).toBe(false);
    });
  });

  // ─── Hook Management ──────────────────────────
  describe('Hook Management', () => {
    it('should add hook dynamically', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      service.addHook({
        getMetadata: () => ({ name: 'Dyn', version: '1.0.0' }),
        beforeEvaluation: async (k) => { calls.push(k); },
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should remove hook and return true', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      service.addHook({ getMetadata: () => ({ name: 'Rem', version: '1.0.0' }) });
      expect(service.removeHook('Rem')).toBe(true);
    });

    it('should return false for non-existent hook', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(service.removeHook('Nope')).toBe(false);
    });
  });

  // ─── Edge Cases ───────────────────────────────
  describe('Edge Cases', () => {
    it('should handle concurrent evaluations', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true, F2: false } });

      const [on1, on2, off1, off2] = await Promise.all([
        service.isFeatureOn('F1'),
        service.isFeatureOn('F2'),
        service.isFeatureOff('F1'),
        service.isFeatureOff('F2'),
      ]);

      expect(on1).toBe(true);
      expect(on2).toBe(false);
      expect(off1).toBe(false);
      expect(off2).toBeTruthy();
    });
  });
});
