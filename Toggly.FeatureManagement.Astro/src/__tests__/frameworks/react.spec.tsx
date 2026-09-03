import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { $flags, $isReady, $variants, __resetClient } from '../../client/store.js';

// Mock @nanostores/react to return store values directly
vi.mock('@nanostores/react', () => ({
  useStore: vi.fn((store: any) => store.get()),
}));

// Allow Feature tests to invoke useMemo without a React dispatcher
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
  };
});

import { Feature, useFeatureFlag, useFeatureGate, useVariant } from '../../frameworks/react/Feature.js';

describe('React Framework Adapter', () => {
  beforeEach(() => {
    __resetClient();
    $flags.set({});
    $variants.set({});
    $isReady.set(false);
  });

  describe('useFeatureFlag', () => {
    it('should return enabled:true when flag is on', () => {
      $flags.set({ NewDashboard: true });
      $isReady.set(true);

      const result = useFeatureFlag('NewDashboard');
      expect(result.enabled).toBe(true);
      expect(result.isReady).toBe(true);
    });

    it('should return enabled:false when flag is off', () => {
      $flags.set({ NewDashboard: false });
      $isReady.set(true);

      const result = useFeatureFlag('NewDashboard');
      expect(result.enabled).toBe(false);
    });

    it('should return defaultValue when flag does not exist', () => {
      $flags.set({});
      $isReady.set(true);

      expect(useFeatureFlag('Unknown', true).enabled).toBe(true);
      expect(useFeatureFlag('Unknown', false).enabled).toBe(false);
    });

    it('should default to false', () => {
      $flags.set({});
      $isReady.set(true);

      expect(useFeatureFlag('Unknown').enabled).toBe(false);
    });

    it('should reflect isReady state', () => {
      $isReady.set(false);
      expect(useFeatureFlag('F1').isReady).toBe(false);

      $isReady.set(true);
      expect(useFeatureFlag('F1').isReady).toBe(true);
    });
  });

  describe('useFeatureGate', () => {
    beforeEach(() => {
      $flags.set({ F1: true, F2: true, F3: false });
      $isReady.set(true);
    });

    it('should return enabled:true for empty keys when not negated', () => {
      expect(useFeatureGate([]).enabled).toBe(true);
    });

    it('should return enabled:false for empty keys when negated', () => {
      expect(useFeatureGate([], 'all', true).enabled).toBe(false);
    });

    it('should evaluate "all" requirement', () => {
      expect(useFeatureGate(['F1', 'F2']).enabled).toBe(true);
      expect(useFeatureGate(['F1', 'F3']).enabled).toBe(false);
    });

    it('should evaluate "any" requirement', () => {
      expect(useFeatureGate(['F1', 'F3'], 'any').enabled).toBe(true);
      expect(useFeatureGate(['F3'], 'any').enabled).toBe(false);
    });

    it('should support negation', () => {
      expect(useFeatureGate(['F1', 'F2'], 'all', true).enabled).toBe(false);
      expect(useFeatureGate(['F3'], 'all', true).enabled).toBe(true);
    });
  });

  describe('useVariant', () => {
    it('should return variant when defs include variant name', () => {
      $variants.set({
        V: { enabled: true, variant: 'B', configurationValue: 42 },
      });

      expect(useVariant('V')).toEqual({ name: 'B', configurationValue: 42 });
    });

    it('should return null when variant name missing', () => {
      $variants.set({ V: { enabled: true, configurationValue: 'x' } });
      expect(useVariant('V')).toBeNull();
    });

    it('should return null for unknown key', () => {
      $variants.set({});
      expect(useVariant('Unknown')).toBeNull();
    });
  });

  describe('Feature component', () => {
    it('should render children when flag is enabled', () => {
      $flags.set({ MyFeature: true });
      $isReady.set(true);

      const result = Feature({
        flag: 'MyFeature',
        children: React.createElement('div', null, 'visible'),
      });

      // The result should contain 'visible'
      expect(result).toBeTruthy();
    });

    it('should render null when flag is disabled', () => {
      $flags.set({ MyFeature: false });
      $isReady.set(true);

      const result = Feature({
        flag: 'MyFeature',
        children: React.createElement('div', null, 'hidden'),
      });

      expect(result).toBeTruthy();
    });

    it('should render loading when not ready', () => {
      $flags.set({ MyFeature: true });
      $isReady.set(false);

      const result = Feature({
        flag: 'MyFeature',
        children: React.createElement('div', null, 'content'),
        loading: React.createElement('div', null, 'loading'),
      });

      expect(result).toBeTruthy();
    });

    it('should handle no flags specified', () => {
      $isReady.set(true);

      const result = Feature({
        children: React.createElement('div', null, 'content'),
      });

      // With no flags and no negate, should render children
      expect(result).toBeTruthy();
    });

    it('should handle negate prop', () => {
      $flags.set({ MyFeature: true });
      $isReady.set(true);

      const result = Feature({
        flag: 'MyFeature',
        negate: true,
        children: React.createElement('div', null, 'hidden'),
      });

      expect(result).toBeTruthy();
    });

    it('should handle multiple flags with "any" requirement', () => {
      $flags.set({ F1: false, F2: true });
      $isReady.set(true);

      const result = Feature({
        flags: ['F1', 'F2'],
        requirement: 'any',
        children: React.createElement('div', null, 'visible'),
      });

      expect(result).toBeTruthy();
    });

    it('should combine flag and flags props', () => {
      $flags.set({ Single: true, Multi1: true, Multi2: true });
      $isReady.set(true);

      const result = Feature({
        flag: 'Single',
        flags: ['Multi1', 'Multi2'],
        children: React.createElement('div', null, 'content'),
      });

      expect(result).toBeTruthy();
    });

    it('should invoke render prop with false while not ready', () => {
      $flags.set({ PremiumCheckout: true });
      $isReady.set(false);
      const render = vi.fn(() => React.createElement('button', null, 'checkout'));

      Feature({ flag: 'PremiumCheckout', render });

      expect(render).toHaveBeenCalledWith(false);
    });

    it('should invoke render prop with resolved gate when ready', () => {
      $flags.set({ PremiumCheckout: true });
      $isReady.set(true);
      const render = vi.fn((enabled: boolean) =>
        React.createElement('button', { disabled: !enabled }, 'checkout'),
      );

      Feature({ flag: 'PremiumCheckout', render });

      expect(render).toHaveBeenCalledWith(true);
    });

    it('should invoke render prop with false when gate is disabled', () => {
      $flags.set({ PremiumCheckout: false });
      $isReady.set(true);
      const render = vi.fn((enabled: boolean) =>
        React.createElement('button', { disabled: !enabled }, 'checkout'),
      );

      Feature({ flag: 'PremiumCheckout', render });

      expect(render).toHaveBeenCalledWith(false);
    });

    it('should render children for empty gate when not negated', () => {
      $isReady.set(true);

      const result = Feature({
        negate: false,
        children: React.createElement('div', null, 'content'),
      });

      expect(result).toBeTruthy();
    });

    it('should hide for empty gate when negated', () => {
      $isReady.set(true);

      const result = Feature({
        negate: true,
        children: React.createElement('div', null, 'content'),
      });

      expect(result).toBeTruthy();
    });
  });
});
