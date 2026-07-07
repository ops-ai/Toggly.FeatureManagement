import { describe, it, expect, beforeEach, vi } from 'vitest';
import { $flags, $isReady, $variants, __resetClient } from '../../client/store.js';

// Mock svelte/store's derived to use a simple implementation
vi.mock('svelte/store', () => ({
  get: vi.fn((store: { get: () => unknown }) => store.get()),
  derived: vi.fn((stores: any, fn: (...args: any[]) => any) => {
    const storeList = Array.isArray(stores) ? stores : [stores]
    const compute = () => {
      if (storeList.length === 1) {
        return fn(storeList[0].get())
      }
      return fn()
    }

    let currentValue = compute()

    return {
      subscribe: (callback: (value: any) => void) => {
        callback(currentValue)
        const unsubs = storeList.map((store) =>
          store.subscribe(() => {
            currentValue = compute()
            callback(currentValue)
          }),
        )
        return () => unsubs.forEach((unsub) => unsub())
      },
      get: () => currentValue,
    }
  }),
}))

import { featureFlag, featureGate, featureVariant, readFeatureGate, flags, isReady, variants } from '../../frameworks/svelte/stores.js';

describe('Svelte Framework Adapter - Stores', () => {
  beforeEach(() => {
    __resetClient();
    $flags.set({});
    $variants.set({});
    $isReady.set(false);
  });

  describe('re-exports', () => {
    it('should export flags store', () => {
      expect(flags).toBeDefined();
    });

    it('should export isReady store', () => {
      expect(isReady).toBeDefined();
    });

    it('should export variants store', () => {
      expect(variants).toBeDefined();
    });
  });

  describe('featureFlag', () => {
    it('should return true when flag is enabled', () => {
      $flags.set({ NewDashboard: true });

      const store = featureFlag('NewDashboard');
      expect(store.get()).toBe(true);
    });

    it('should return false when flag is disabled', () => {
      $flags.set({ NewDashboard: false });

      const store = featureFlag('NewDashboard');
      expect(store.get()).toBe(false);
    });

    it('should return defaultValue for unknown flags', () => {
      $flags.set({});

      const s1 = featureFlag('Unknown', true);
      expect(s1.get()).toBe(true);

      const s2 = featureFlag('Unknown', false);
      expect(s2.get()).toBe(false);
    });

    it('should default to false', () => {
      $flags.set({});

      const store = featureFlag('Unknown');
      expect(store.get()).toBe(false);
    });

    it('should support subscribe pattern', () => {
      $flags.set({ Feature1: true });

      const store = featureFlag('Feature1');
      let value: boolean | undefined;

      store.subscribe((v: boolean) => {
        value = v;
      });

      expect(value).toBe(true);
    });
  });

  describe('featureGate', () => {
    beforeEach(() => {
      $flags.set({ F1: true, F2: true, F3: false });
    });

    it('should return true for empty keys when not negated', () => {
      const store = featureGate([]);
      expect(store.get()).toBe(true);
    });

    it('should return false for empty keys when negated', () => {
      const store = featureGate([], 'all', true);
      expect(store.get()).toBe(false);
    });

    it('should evaluate "all" requirement', () => {
      expect(featureGate(['F1', 'F2']).get()).toBe(true);
      expect(featureGate(['F1', 'F3']).get()).toBe(false);
    });

    it('should evaluate "any" requirement', () => {
      expect(featureGate(['F1', 'F3'], 'any').get()).toBe(true);
      expect(featureGate(['F3'], 'any').get()).toBe(false);
    });

    it('should support negation', () => {
      expect(featureGate(['F1', 'F2'], 'all', true).get()).toBe(false);
      expect(featureGate(['F3'], 'all', true).get()).toBe(true);
    });

    it('should support subscribe pattern', () => {
      const store = featureGate(['F1', 'F2']);
      let value: boolean | undefined;

      store.subscribe((v: boolean) => {
        value = v;
      });

      expect(value).toBe(true);
    });
  });

  describe('featureVariant', () => {
    it('should return variant when defs include variant name', () => {
      $variants.set({
        V: { enabled: true, variant: 'B', configurationValue: 42 },
      });

      const store = featureVariant('V');
      expect(store.get()).toEqual({ name: 'B', configurationValue: 42 });
    });

    it('should return null when variant name missing', () => {
      $variants.set({ V: { enabled: true, configurationValue: 'x' } });
      expect(featureVariant('V').get()).toBeNull();
    });
  });

  describe('readFeatureGate', () => {
    beforeEach(() => {
      $flags.set({ F1: true, F2: true, F3: false });
    });

    it('should read gate synchronously with all requirement', () => {
      expect(readFeatureGate(['F1', 'F2'], 'all')).toBe(true);
      expect(readFeatureGate(['F1', 'F3'], 'all')).toBe(false);
    });

    it('should read gate synchronously with any requirement and negate', () => {
      expect(readFeatureGate(['F1', 'F3'], 'any')).toBe(true);
      expect(readFeatureGate(['F3'], 'all', true)).toBe(true);
    });
  });
});
