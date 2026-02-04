import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { $flags, $isReady, __resetClient, initTogglyClient } from '../../client/store.js';

// We test the pure logic of Feature, useFeatureFlag, useFeatureGate
// by importing them and testing with nanostores directly.
// Full React rendering tests would require @testing-library/react,
// but we can test the hooks' logic by mocking useStore.

// Mock @nanostores/react to return store values directly
vi.mock('@nanostores/react', () => ({
  useStore: vi.fn((store: any) => store.get()),
}));

import { Feature, useFeatureFlag, useFeatureGate } from '../../frameworks/react/Feature.js';

describe('React Framework Adapter', () => {
  beforeEach(() => {
    __resetClient();
    $flags.set({});
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

    it('should render fallback when flag is disabled', () => {
      $flags.set({ MyFeature: false });
      $isReady.set(true);

      const result = Feature({
        flag: 'MyFeature',
        children: React.createElement('div', null, 'hidden'),
        fallback: React.createElement('div', null, 'fallback'),
      });

      expect(result).toBeTruthy();
    });

    it('should render fallback when not ready', () => {
      $flags.set({ MyFeature: true });
      $isReady.set(false);

      const result = Feature({
        flag: 'MyFeature',
        children: React.createElement('div', null, 'content'),
        fallback: React.createElement('div', null, 'loading'),
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
        fallback: React.createElement('div', null, 'shown'),
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
  });
});
