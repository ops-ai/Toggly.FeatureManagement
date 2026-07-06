import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  togglyServiceStore,
  togglyFlagsStore,
  togglyVariantsStore,
  getTogglyService,
  createFeatureStore,
  createVariantStore,
  createVariantValueStore,
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
} from '../stores/toggly.store';
import { Toggly } from '../services/toggly.service';

describe('Toggly Store', () => {
  beforeEach(() => {
    // Reset stores between tests
    togglyServiceStore.set(null);
    togglyFlagsStore.set({});
    togglyVariantsStore.set({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ─── togglyServiceStore ──────────────────────
  describe('togglyServiceStore', () => {
    it('should initialize as null', () => {
      expect(get(togglyServiceStore)).toBeNull();
    });

    it('should store a Toggly service instance', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      togglyServiceStore.set(service);
      expect(get(togglyServiceStore)).toBe(service);
    });
  });

  // ─── togglyFlagsStore ──────────────────────
  describe('togglyFlagsStore', () => {
    it('should initialize as empty object', () => {
      expect(get(togglyFlagsStore)).toEqual({});
    });

    it('should store flags', () => {
      togglyFlagsStore.set({ F1: true, F2: false });
      expect(get(togglyFlagsStore)).toEqual({ F1: true, F2: false });
    });
  });

  // ─── getTogglyService ──────────────────────
  describe('getTogglyService', () => {
    it('should throw when service not initialized', () => {
      expect(() => getTogglyService()).toThrow(
        'Toggly service not initialized. Call createToggly() first.'
      );
    });

    it('should return service when initialized', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      togglyServiceStore.set(service);
      expect(getTogglyService()).toBe(service);
    });
  });

  // ─── createFeatureStore ──────────────────────
  describe('createFeatureStore', () => {
    it('should create a derived store for a feature key', () => {
      togglyFlagsStore.set({ F1: true, F2: false });
      const f1Store = createFeatureStore('F1');
      expect(get(f1Store)).toBe(true);
    });

    it('should return false for unknown feature key', () => {
      togglyFlagsStore.set({ F1: true });
      const unknownStore = createFeatureStore('Unknown');
      expect(get(unknownStore)).toBe(false);
    });

    it('should reactively update when flags change', () => {
      const f1Store = createFeatureStore('F1');
      expect(get(f1Store)).toBe(false);

      togglyFlagsStore.set({ F1: true });
      expect(get(f1Store)).toBe(true);

      togglyFlagsStore.set({ F1: false });
      expect(get(f1Store)).toBe(false);
    });

    it('uses service effective value when service is set', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      vi.spyOn(service, 'getEffectiveFlagValue').mockReturnValue(true);
      togglyServiceStore.set(service);
      togglyFlagsStore.set({ F1: false });
      expect(get(createFeatureStore('F1'))).toBe(true);
    });
  });

  // ─── togglyVariantsStore & createVariantStore ──────────────────────
  describe('togglyVariantsStore and variant derived stores', () => {
    it('createVariantStore returns null when no variant', () => {
      togglyVariantsStore.set({ F: { enabled: true } });
      expect(get(createVariantStore('F'))).toBeNull();
    });

    it('createVariantStore maps variant name and configurationValue', () => {
      togglyVariantsStore.set({
        X: { enabled: true, variant: 'blue', configurationValue: 'hex' },
      });
      expect(get(createVariantStore('X'))).toEqual({
        name: 'blue',
        configurationValue: 'hex',
      });
    });

    it('uses service.getVariant when service is set', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      vi.spyOn(service, 'getVariant').mockReturnValue({ name: 'A', configurationValue: 1 });
      togglyServiceStore.set(service);
      togglyVariantsStore.set({});
      expect(get(createVariantStore('F1'))).toEqual({ name: 'A', configurationValue: 1 });
    });

    it('createVariantValueStore returns null when variant name is missing', () => {
      togglyVariantsStore.set({ F: { enabled: true } });
      expect(get(createVariantValueStore('F'))).toBeNull();
    });

    it('createVariantValueStore returns configuration only', () => {
      togglyVariantsStore.set({
        X: { enabled: true, variant: 'blue', configurationValue: 42 },
      });
      expect(get(createVariantValueStore('X'))).toBe(42);
    });
  });

  // ─── isFeatureOn ──────────────────────
  describe('isFeatureOn', () => {
    it('should return true for enabled feature', async () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      togglyServiceStore.set(service);

      const result = await isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      const service = new Toggly({ featureDefaults: { F1: false } });
      togglyServiceStore.set(service);

      const result = await isFeatureOn('F1');
      expect(result).toBe(false);
    });

    it('should throw when service not initialized', async () => {
      await expect(isFeatureOn('F1')).rejects.toThrow(
        'Toggly service not initialized'
      );
    });
  });

  // ─── isFeatureOff ──────────────────────
  describe('isFeatureOff', () => {
    it('should return true for disabled feature', async () => {
      const service = new Toggly({ featureDefaults: { F1: false } });
      togglyServiceStore.set(service);

      const result = await isFeatureOff('F1');
      expect(result).toBe(true);
    });

    it('should return false for enabled feature', async () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      togglyServiceStore.set(service);

      const result = await isFeatureOff('F1');
      expect(result).toBe(false);
    });

    it('should throw when service not initialized', async () => {
      await expect(isFeatureOff('F1')).rejects.toThrow(
        'Toggly service not initialized'
      );
    });
  });

  // ─── evaluateFeatureGate ──────────────────────
  describe('evaluateFeatureGate', () => {
    it('should evaluate "all" requirement', async () => {
      const service = new Toggly({ featureDefaults: { F1: true, F2: true } });
      togglyServiceStore.set(service);

      const result = await evaluateFeatureGate(['F1', 'F2'], 'all', false);
      expect(result).toBe(true);
    });

    it('should evaluate "any" requirement', async () => {
      const service = new Toggly({ featureDefaults: { F1: true, F2: false } });
      togglyServiceStore.set(service);

      const result = await evaluateFeatureGate(['F1', 'F2'], 'any', false);
      expect(result).toBe(true);
    });

    it('should support negate', async () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      togglyServiceStore.set(service);

      const result = await evaluateFeatureGate(['F1'], 'all', true);
      expect(result).toBe(false);
    });

    it('should throw when service not initialized', async () => {
      await expect(evaluateFeatureGate(['F1'], 'all', false)).rejects.toThrow(
        'Toggly service not initialized'
      );
    });

    it('should use default parameters', async () => {
      const service = new Toggly({ featureDefaults: { F1: true, F2: false } });
      togglyServiceStore.set(service);

      // Default: requirement='all', negate=false
      const result = await evaluateFeatureGate(['F1', 'F2']);
      expect(result).toBeFalsy();
    });
  });
});
