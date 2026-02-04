import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, type Ref } from 'vue';
import { $flags, $isReady, __resetClient } from '../../client/store.js';

// Mock @nanostores/vue to return reactive vue refs
vi.mock('@nanostores/vue', () => ({
  useStore: vi.fn((store: any) => ref(store.get())),
}));

import { useFeatureFlag, useFeatureGate } from '../../frameworks/vue/composables.js';
import { useStore } from '@nanostores/vue';

// Helper to get the inner value from a Ref
function getValue(r: Readonly<Ref<boolean>>): boolean {
  return r.value;
}

function resetMock() {
  vi.mocked(useStore).mockImplementation((store: any) => ref(store.get()));
}

describe('Vue Framework Adapter - Composables', () => {
  beforeEach(() => {
    __resetClient();
    $flags.set({});
    $isReady.set(false);
    vi.clearAllMocks();
    resetMock();
  });

  describe('useFeatureFlag', () => {
    it('should return enabled:true when flag is on', () => {
      $flags.set({ NewDashboard: true });
      $isReady.set(true);
      resetMock();

      const { enabled, isReady } = useFeatureFlag('NewDashboard');
      expect(getValue(enabled)).toBe(true);
      expect(getValue(isReady)).toBe(true);
    });

    it('should return enabled:false when flag is off', () => {
      $flags.set({ NewDashboard: false });
      $isReady.set(true);
      resetMock();

      const { enabled } = useFeatureFlag('NewDashboard');
      expect(getValue(enabled)).toBe(false);
    });

    it('should return defaultValue for unknown flags', () => {
      $flags.set({});
      $isReady.set(true);
      resetMock();

      const { enabled: e1 } = useFeatureFlag('Unknown', true);
      expect(getValue(e1)).toBe(true);

      const { enabled: e2 } = useFeatureFlag('Unknown', false);
      expect(getValue(e2)).toBe(false);
    });

    it('should default to false', () => {
      $flags.set({});
      $isReady.set(true);
      resetMock();

      const { enabled } = useFeatureFlag('Unknown');
      expect(getValue(enabled)).toBe(false);
    });
  });

  describe('useFeatureGate', () => {
    beforeEach(() => {
      $flags.set({ F1: true, F2: true, F3: false });
      $isReady.set(true);
      resetMock();
    });

    it('should return true for empty keys when not negated', () => {
      const { enabled } = useFeatureGate([]);
      expect(getValue(enabled)).toBe(true);
    });

    it('should return false for empty keys when negated', () => {
      const { enabled } = useFeatureGate([], 'all', true);
      expect(getValue(enabled)).toBe(false);
    });

    it('should evaluate "all" requirement', () => {
      const { enabled: e1 } = useFeatureGate(['F1', 'F2']);
      expect(getValue(e1)).toBe(true);

      const { enabled: e2 } = useFeatureGate(['F1', 'F3']);
      expect(getValue(e2)).toBe(false);
    });

    it('should evaluate "any" requirement', () => {
      const { enabled: e1 } = useFeatureGate(['F1', 'F3'], 'any');
      expect(getValue(e1)).toBe(true);

      const { enabled: e2 } = useFeatureGate(['F3'], 'any');
      expect(getValue(e2)).toBe(false);
    });

    it('should support negation', () => {
      const { enabled: e1 } = useFeatureGate(['F1', 'F2'], 'all', true);
      expect(getValue(e1)).toBe(false);

      const { enabled: e2 } = useFeatureGate(['F3'], 'all', true);
      expect(getValue(e2)).toBe(true);
    });
  });
});
