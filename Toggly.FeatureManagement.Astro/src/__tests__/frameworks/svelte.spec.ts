import { describe, it, expect, beforeEach, vi } from 'vitest';
import { $flags, $isReady, __resetClient } from '../../client/store.js';

// Mock svelte/store's derived to use a simple implementation
vi.mock('svelte/store', () => ({
  derived: vi.fn((store: any, fn: (value: any) => any) => {
    // Return an object that mimics a Svelte store with subscribe
    let currentValue = fn(store.get());

    return {
      subscribe: (callback: (value: any) => void) => {
        callback(currentValue);
        const unsub = store.subscribe((val: any) => {
          currentValue = fn(val);
          callback(currentValue);
        });
        return unsub;
      },
      // Helper for testing
      get: () => currentValue,
    };
  }),
}));

import { featureFlag, featureGate, flags, isReady } from '../../frameworks/svelte/stores.js';

describe('Svelte Framework Adapter - Stores', () => {
  beforeEach(() => {
    __resetClient();
    $flags.set({});
    $isReady.set(false);
  });

  describe('re-exports', () => {
    it('should export flags store', () => {
      expect(flags).toBeDefined();
    });

    it('should export isReady store', () => {
      expect(isReady).toBeDefined();
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
});
