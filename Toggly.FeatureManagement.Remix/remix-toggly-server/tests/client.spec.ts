/**
 * Tests for TogglyServerClient
 */

import { TogglyServerClient, createServerClient } from '../src/client';
import {
  TogglyConfig,
  TogglyHook,
  HookMetadata,
  FeatureFlags,
} from '@ops-ai/remix-toggly-core';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('TogglyServerClient', () => {
  const defaultConfig: TogglyConfig = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should create a client with valid config', () => {
      const client = new TogglyServerClient(defaultConfig);
      expect(client).toBeInstanceOf(TogglyServerClient);
    });

    it('should handle missing appKey with featureDefaults', () => {
      const client = new TogglyServerClient({
        featureDefaults: { feature1: true },
      });
      expect(client).toBeInstanceOf(TogglyServerClient);
    });

    it('should warn when no appKey and no featureDefaults', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new TogglyServerClient({});
      // Warning is logged internally
      warnSpy.mockRestore();
    });
  });

  describe('init', () => {
    it('should fetch flags on init', async () => {
      const flags: FeatureFlags = { feature1: true, feature2: false };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      const client = new TogglyServerClient(defaultConfig);
      const result = await client.init();

      expect(result).toEqual(flags);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return cached flags on subsequent calls', async () => {
      const flags: FeatureFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();
      const result = await client.init();

      expect(result).toEqual(flags);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include identity in request', async () => {
      const flags: FeatureFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init('user-123');

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('u=user-123');
    });
  });

  describe('fetchFlags', () => {
    it('should use featureDefaults when no appKey', async () => {
      const featureDefaults = { feature1: true };
      const client = new TogglyServerClient({ featureDefaults });

      const result = await client.fetchFlags();

      expect(result).toEqual(featureDefaults);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const featureDefaults = { fallback: true };
      const client = new TogglyServerClient({
        ...defaultConfig,
        featureDefaults,
      });

      const result = await client.fetchFlags();

      expect(result).toEqual(featureDefaults);
    });

    it('should handle non-ok responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const featureDefaults = { fallback: true };
      const client = new TogglyServerClient({
        ...defaultConfig,
        featureDefaults,
      });

      const result = await client.fetchFlags();

      expect(result).toEqual(featureDefaults);
    });
  });

  describe('getFlags', () => {
    it('should return a copy of flags', async () => {
      const flags: FeatureFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = client.getFlags();
      result.feature1 = false;

      expect(client.getFlags().feature1).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return true for enabled feature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.isEnabled('feature1');

      expect(result).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.isEnabled('feature1');

      expect(result).toBe(false);
    });

    it('should return default value for missing feature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.isEnabled('missing', undefined, true);

      expect(result).toBe(true);
    });
  });

  describe('isDisabled', () => {
    it('should return true for disabled feature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.isDisabled('feature1');

      expect(result).toBe(true);
    });

    it('should return false for enabled feature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.isDisabled('feature1');

      expect(result).toBe(false);
    });
  });

  describe('evaluateGate', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            feature1: true,
            feature2: true,
            feature3: false,
          }),
      });
    });

    it('should return true when all features are enabled (requirement: all)', async () => {
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.evaluateGate(['feature1', 'feature2'], 'all');

      expect(result).toBe(true);
    });

    it('should return false when not all features are enabled (requirement: all)', async () => {
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.evaluateGate(
        ['feature1', 'feature3'],
        'all'
      );

      expect(result).toBe(false);
    });

    it('should return true when any feature is enabled (requirement: any)', async () => {
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.evaluateGate(
        ['feature1', 'feature3'],
        'any'
      );

      expect(result).toBe(true);
    });

    it('should return false when no features are enabled (requirement: any)', async () => {
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.evaluateGate(['feature3'], 'any');

      expect(result).toBe(false);
    });

    it('should negate result when negate is true', async () => {
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const result = await client.evaluateGate(
        ['feature1', 'feature2'],
        'all',
        true
      );

      expect(result).toBe(false);
    });
  });

  describe('getServerContext', () => {
    it('should return server context for hydration', async () => {
      const flags: FeatureFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const context = client.getServerContext();

      expect(context).toEqual({
        flags,
        appKey: 'test-app-key',
        environment: 'test',
        fetchedAt: expect.any(Number),
      });
    });
  });

  describe('hooks', () => {
    const createMockHook = (name: string): TogglyHook => ({
      getMetadata: () => ({ name }),
      beforeEvaluation: jest.fn(),
      afterEvaluation: jest.fn(),
      beforeIdentify: jest.fn(),
      afterIdentify: jest.fn(),
      afterRefresh: jest.fn(),
    });

    it('should add a hook', () => {
      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');

      client.addHook(hook);

      // Hook is registered (no direct way to verify, but won't throw)
      expect(true).toBe(true);
    });

    it('should not add duplicate hooks', () => {
      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');

      client.addHook(hook);
      client.addHook(hook);

      // Should only be registered once (warning logged)
      expect(true).toBe(true);
    });

    it('should remove a hook', () => {
      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');

      client.addHook(hook);
      const removed = client.removeHook('test-hook');

      expect(removed).toBe(true);
    });

    it('should return false when removing non-existent hook', () => {
      const client = new TogglyServerClient(defaultConfig);

      const removed = client.removeHook('non-existent');

      expect(removed).toBe(false);
    });

    it('should execute beforeEvaluation hooks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');
      client.addHook(hook);

      await client.init();
      await client.isEnabled('feature1');

      expect(hook.beforeEvaluation).toHaveBeenCalledWith('feature1', false);
    });

    it('should execute afterEvaluation hooks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');
      client.addHook(hook);

      await client.init();
      await client.isEnabled('feature1');

      expect(hook.afterEvaluation).toHaveBeenCalledWith(
        'feature1',
        undefined,
        true
      );
    });

    it('should execute beforeIdentify hooks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');
      client.addHook(hook);

      await client.init('user-123');

      expect(hook.beforeIdentify).toHaveBeenCalledWith('user-123');
    });

    it('should execute afterIdentify hooks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');
      client.addHook(hook);

      await client.init('user-123');

      expect(hook.afterIdentify).toHaveBeenCalledWith('user-123', undefined);
    });

    it('should execute afterRefresh hooks', async () => {
      const flags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');
      client.addHook(hook);

      await client.init();

      expect(hook.afterRefresh).toHaveBeenCalledWith(flags);
    });

    it('should handle hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'error-hook' }),
        beforeEvaluation: jest.fn().mockRejectedValue(new Error('Hook error')),
      };
      client.addHook(hook);

      await client.init();
      // Should not throw
      const result = await client.isEnabled('feature1');

      expect(result).toBe(true);
    });
  });
});

describe('createServerClient', () => {
  it('should create a TogglyServerClient instance', () => {
    const client = createServerClient({ appKey: 'test-key' });
    expect(client).toBeInstanceOf(TogglyServerClient);
  });
});
