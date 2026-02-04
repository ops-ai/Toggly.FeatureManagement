import { describe, it, expect, vi } from 'vitest';
import {
  getTogglyFromAstroGlobal,
  withFeatureFlag,
  anyFeatureEnabled,
  allFeaturesEnabled,
} from '../../server/utils.js';
import type { TogglyClient } from '../../types/index.js';

function createMockAstro(toggly?: TogglyClient) {
  return {
    locals: {
      toggly,
    },
  } as any;
}

function createMockTogglyClient(flags: Record<string, boolean>): TogglyClient {
  return {
    getFlags: vi.fn().mockResolvedValue({ ...flags }),
    getFlag: vi.fn().mockImplementation((key: string, defaultValue = false) => {
      return Promise.resolve(flags[key] ?? defaultValue);
    }),
    evaluateGate: vi.fn().mockImplementation(
      (keys: string[], requirement: 'all' | 'any' = 'all', negate = false) => {
        if (keys.length === 0) return Promise.resolve(!negate);
        let result: boolean;
        if (requirement === 'any') {
          result = keys.some((key) => flags[key] === true);
        } else {
          result = keys.every((key) => flags[key] === true);
        }
        return Promise.resolve(negate ? !result : result);
      }
    ),
    refreshFlags: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Server Utils', () => {
  describe('getTogglyFromAstroGlobal', () => {
    it('should return toggly client from Astro.locals', () => {
      const mockClient = createMockTogglyClient({ F1: true });
      const mockAstro = createMockAstro(mockClient);

      const result = getTogglyFromAstroGlobal(mockAstro);
      expect(result).toBe(mockClient);
    });

    it('should throw when toggly is not initialized', () => {
      const mockAstro = createMockAstro(undefined);

      expect(() => getTogglyFromAstroGlobal(mockAstro)).toThrow(
        '[Toggly] Client not initialized'
      );
    });

    it('should throw when Astro.locals.toggly is null', () => {
      const mockAstro = { locals: { toggly: null } } as any;

      expect(() => getTogglyFromAstroGlobal(mockAstro)).toThrow(
        '[Toggly] Client not initialized'
      );
    });
  });

  describe('withFeatureFlag', () => {
    it('should return true when feature flag is enabled', async () => {
      const mockClient = createMockTogglyClient({ MyFeature: true });
      const mockAstro = createMockAstro(mockClient);

      const result = await withFeatureFlag('MyFeature', mockAstro);
      expect(result).toBe(true);
      expect(mockClient.getFlag).toHaveBeenCalledWith('MyFeature', false);
    });

    it('should return false when feature flag is disabled', async () => {
      const mockClient = createMockTogglyClient({ MyFeature: false });
      const mockAstro = createMockAstro(mockClient);

      const result = await withFeatureFlag('MyFeature', mockAstro);
      expect(result).toBe(false);
    });

    it('should return false when feature flag does not exist', async () => {
      const mockClient = createMockTogglyClient({});
      const mockAstro = createMockAstro(mockClient);

      const result = await withFeatureFlag('NonExistent', mockAstro);
      expect(result).toBe(false);
    });

    it('should return false when toggly is not initialized', async () => {
      const mockAstro = createMockAstro(undefined);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await withFeatureFlag('MyFeature', mockAstro);
      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should log error when evaluation fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockAstro = createMockAstro(undefined);

      await withFeatureFlag('MyFeature', mockAstro);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Toggly] Error evaluating feature flag'),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });
  });

  describe('anyFeatureEnabled', () => {
    it('should return true when at least one feature is enabled', async () => {
      const mockClient = createMockTogglyClient({
        Feature1: true,
        Feature2: false,
      });
      const mockAstro = createMockAstro(mockClient);

      const result = await anyFeatureEnabled(['Feature1', 'Feature2'], mockAstro);
      expect(result).toBe(true);
      expect(mockClient.evaluateGate).toHaveBeenCalledWith(
        ['Feature1', 'Feature2'],
        'any',
        false
      );
    });

    it('should return false when no features are enabled', async () => {
      const mockClient = createMockTogglyClient({
        Feature1: false,
        Feature2: false,
      });
      const mockAstro = createMockAstro(mockClient);

      const result = await anyFeatureEnabled(['Feature1', 'Feature2'], mockAstro);
      expect(result).toBe(false);
    });

    it('should return false when toggly is not initialized', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockAstro = createMockAstro(undefined);

      const result = await anyFeatureEnabled(['Feature1'], mockAstro);
      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('allFeaturesEnabled', () => {
    it('should return true when all features are enabled', async () => {
      const mockClient = createMockTogglyClient({
        Feature1: true,
        Feature2: true,
      });
      const mockAstro = createMockAstro(mockClient);

      const result = await allFeaturesEnabled(['Feature1', 'Feature2'], mockAstro);
      expect(result).toBe(true);
      expect(mockClient.evaluateGate).toHaveBeenCalledWith(
        ['Feature1', 'Feature2'],
        'all',
        false
      );
    });

    it('should return false when not all features are enabled', async () => {
      const mockClient = createMockTogglyClient({
        Feature1: true,
        Feature2: false,
      });
      const mockAstro = createMockAstro(mockClient);

      const result = await allFeaturesEnabled(['Feature1', 'Feature2'], mockAstro);
      expect(result).toBe(false);
    });

    it('should return false when toggly is not initialized', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockAstro = createMockAstro(undefined);

      const result = await allFeaturesEnabled(['Feature1'], mockAstro);
      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });
  });
});
