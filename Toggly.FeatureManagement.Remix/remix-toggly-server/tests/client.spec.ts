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
import * as signedResponse from '../src/signed-response';

jest.mock('../src/signed-response', () => {
  const actual = jest.requireActual('../src/signed-response');
  return {
    ...actual,
    parseEvaluatedResponseBody: jest.fn((...args: unknown[]) =>
      actual.parseEvaluatedResponseBody(...args),
    ),
  };
});

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Capture WS event handlers so tests can simulate WS events
let wsHandlers: Record<string, (...args: any[]) => void> = {};
let wsInstance: any = null;

// Mock WebSocket to prevent real connections in unit tests
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => {
    wsHandlers = {};
    const instance = {
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        wsHandlers[event] = handler;
      }),
      close: jest.fn(),
      removeAllListeners: jest.fn(),
      send: jest.fn(),
      readyState: 1, // OPEN
    };
    wsInstance = instance;
    return instance;
  });
});

describe('TogglyServerClient', () => {
  const defaultConfig: TogglyConfig = {
    appKey: 'test-app-key',
    environment: 'test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    wsHandlers = {};
    wsInstance = null;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      new TogglyServerClient({});

      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly]',
        'No appKey provided and no featureDefaults set. All features will be disabled.'
      );
    });

    it('should apply local gates from config', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient({
        ...defaultConfig,
        localGates: [{
          id: 'gate1',
          flagKeys: ['feature1'],
          isEnabled: () => false,
        }],
      });

      await client.init();
      expect(await client.isEnabled('feature1')).toBe(false);
    });

    it('reads text() and falls back when verifySignatures gets invalid envelope', async () => {
      const invalidBody = JSON.stringify({ defs: { feature1: true } });
      const text = jest.fn().mockResolvedValue(invalidBody);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text,
        json: () => Promise.resolve(JSON.parse(invalidBody)),
      });

      const client = new TogglyServerClient({
        ...defaultConfig,
        verifySignatures: true,
        featureDefaults: { feature1: false },
      });

      const flags = await client.init();
      expect(text).toHaveBeenCalled();
      expect(flags).toEqual({ feature1: false });
    });

    it('unwraps a verified defs envelope when signatures are enabled', async () => {
      (signedResponse.parseEvaluatedResponseBody as jest.Mock).mockResolvedValueOnce({
        defs: { feature1: true },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
        json: () => Promise.resolve({}),
        headers: { get: () => null },
      });

      const client = new TogglyServerClient({
        ...defaultConfig,
        verifySignatures: true,
      });

      const flags = await client.init();
      expect(flags).toEqual({ feature1: true });
    });
  });

  describe('local gate subscriptions', () => {
    it('should notify subscribers when local gates change', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      let notified = false;
      const unsubscribe = client.subscribeLocalGatesChanged(() => {
        notified = true;
      });

      client.setLocalGates([{
        id: 'gate1',
        flagKeys: ['feature1'],
        isEnabled: () => false,
      }]);
      client.notifyLocalGatesChanged();

      expect(notified).toBe(true);
      unsubscribe();
    });

    it('should swallow listener errors during notifyLocalGatesChanged', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      client.subscribeLocalGatesChanged(() => {
        throw new Error('listener failed');
      });

      expect(() => client.notifyLocalGatesChanged()).not.toThrow();
      expect(console.error).toHaveBeenCalled();
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
      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly]',
        'Failed to fetch flags, preserving last-known-good flags when available.',
        expect.any(Error)
      );
    });

    it('should invoke onError when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const onError = jest.fn();
      const client = new TogglyServerClient({
        ...defaultConfig,
        featureDefaults: { fallback: true },
        onError,
      });

      await client.fetchFlags();

      expect(onError).toHaveBeenCalledWith(
        'Error fetching feature flags',
        expect.any(Error),
      );
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
      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly]',
        'Failed to fetch flags, preserving last-known-good flags when available.',
        expect.any(Error)
      );
    });

    it('should extract flags from defs property in response', async () => {
      const flags: FeatureFlags = { feature1: true, feature2: false };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ defs: flags }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const result = await client.fetchFlags();

      expect(result).toEqual(flags);
    });

    it('should return existing flags on 304 Not Modified', async () => {
      const flags: FeatureFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(flags),
        headers: { get: () => '"rev-quoted"' },
      });

      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 304,
        statusText: 'Not Modified',
        json: () => Promise.resolve({}),
        headers: { get: () => null },
      });

      const result = await client.fetchFlags();
      expect(result).toEqual(flags);
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

    it('should return true for an empty gate without negation', async () => {
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      expect(await client.evaluateGate([], 'all', false)).toBe(true);
      expect(await client.evaluateGate([], 'all', true)).toBe(false);
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

      expect(client.removeHook('test-hook')).toBe(true);
    });

    it('should not add duplicate hooks', () => {
      const client = new TogglyServerClient(defaultConfig);
      const hook = createMockHook('test-hook');

      client.addHook(hook);
      client.addHook(hook);

      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly]',
        'Hook "test-hook" already registered. Skipping.'
      );
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
      expect(console.error).toHaveBeenCalledWith(
        '[Toggly]',
        'Error in hook "error-hook.beforeEvaluation":',
        expect.any(Error)
      );
    });

    it('should handle afterEvaluation hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'after-error-hook' }),
        afterEvaluation: jest.fn().mockRejectedValue(new Error('After hook error')),
      };
      client.addHook(hook);

      await client.init();
      const result = await client.isEnabled('feature1');

      expect(result).toBe(true);
      expect(console.error).toHaveBeenCalledWith(
        '[Toggly]',
        'Error in hook "after-error-hook.afterEvaluation":',
        expect.any(Error)
      );
    });

    it('should handle beforeIdentify hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'identify-error-hook' }),
        beforeIdentify: jest.fn().mockRejectedValue(new Error('Before identify error')),
      };
      client.addHook(hook);

      await client.init('user-123');

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly]',
        'Error in hook "identify-error-hook.beforeIdentify":',
        expect.any(Error)
      );
    });

    it('should handle afterIdentify hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'after-identify-error-hook' }),
        afterIdentify: jest.fn().mockRejectedValue(new Error('After identify error')),
      };
      client.addHook(hook);

      await client.init('user-123');

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly]',
        'Error in hook "after-identify-error-hook.afterIdentify":',
        expect.any(Error)
      );
    });

    it('should handle afterRefresh hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'refresh-error-hook' }),
        afterRefresh: jest.fn().mockRejectedValue(new Error('Refresh hook error')),
      };
      client.addHook(hook);

      await client.init();

      expect(console.error).toHaveBeenCalledWith(
        '[Toggly]',
        'Error in hook "refresh-error-hook.afterRefresh":',
        expect.any(Error)
      );
    });

    it('should skip hook methods that are not defined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const client = new TogglyServerClient(defaultConfig);
      const minimalHook: TogglyHook = {
        getMetadata: () => ({ name: 'minimal-hook' }),
        // No optional methods: beforeEvaluation, afterEvaluation, beforeIdentify, afterIdentify, afterRefresh
      };
      client.addHook(minimalHook);

      // Should complete without errors when optional hook methods are absent
      await client.init('user-123');
      const result = await client.isEnabled('feature1');
      expect(result).toBe(true);
    });
  });

  describe('isWsConnected', () => {
    it('should return false before init', () => {
      const client = new TogglyServerClient(defaultConfig);
      expect(client.isWsConnected).toBe(false);
    });
  });

  describe('WebSocket behavior', () => {
    const initClient = async (flags: FeatureFlags = { feature1: true }) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });
      const client = new TogglyServerClient(defaultConfig);
      await client.init();
      return client;
    };

    it('should set isWsConnected to true when open event fires', async () => {
      const client = await initClient();

      expect(client.isWsConnected).toBe(false);
      wsHandlers['open']?.();
      expect(client.isWsConnected).toBe(true);

      client.close();
    });

    it('should refresh flags when flags-updated JSON message is received', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      wsHandlers['message']?.(Buffer.from(JSON.stringify({ type: 'flags-updated' })));
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('should refresh flags when update JSON message is received', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      wsHandlers['message']?.(Buffer.from(JSON.stringify({ type: 'update' })));
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('should ignore ping JSON messages', async () => {
      const client = await initClient();

      wsHandlers['message']?.(Buffer.from(JSON.stringify({ type: 'ping' })));
      await new Promise((r) => setImmediate(r));

      // Only the initial fetch, no refresh triggered
      expect(mockFetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it('should refresh flags when sync JSON message is received', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      wsHandlers['message']?.(Buffer.from(JSON.stringify({ type: 'sync', etag: 'new-rev' })));
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('should refresh flags when signing-key-updated JSON message is received', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      wsHandlers['message']?.(Buffer.from(JSON.stringify({ type: 'signing-key-updated' })));
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('caches etag from flags-updated without treating an empty revision as a change', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      wsHandlers['message']?.(
        Buffer.from(JSON.stringify({ type: 'update', etag: 'rev-2' })),
      );
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('clears a pending refresh debounce when closed', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: false }),
      });

      wsHandlers['message']?.(Buffer.from(JSON.stringify({ type: 'update' })));
      client.close();
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('should refresh flags on plain text "update" message', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      wsHandlers['message']?.(Buffer.from('update'));
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('should refresh flags on plain text "flags-updated" message', async () => {
      jest.useFakeTimers();
      const client = await initClient();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      wsHandlers['message']?.(Buffer.from('flags-updated'));
      jest.advanceTimersByTime(350);
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
      client.close();
    });

    it('should ignore unknown plain text messages', async () => {
      const client = await initClient();

      wsHandlers['message']?.(Buffer.from('heartbeat'));
      await new Promise((r) => setImmediate(r));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      client.close();
    });

    it('should schedule reconnect and reset wsConnected on close event', async () => {
      jest.useFakeTimers();
      const client = await initClient();

      wsHandlers['open']?.();
      expect(client.isWsConnected).toBe(true);

      wsHandlers['close']?.();
      expect(client.isWsConnected).toBe(false);

      jest.useRealTimers();
      client.close();
    });

    it('should log error on WebSocket error event', async () => {
      const client = await initClient();

      wsHandlers['error']?.(new Error('Connection refused'));

      expect(console.error).toHaveBeenCalled();
      client.close();
    });

    it('should not start WebSocket when no appKey is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
      const client = new TogglyServerClient({
        featureDefaults: { feature1: true },
      });
      await client.init();

      // wsInstance should be null since no appKey was provided
      expect(wsInstance).toBeNull();
    });

    it('should not create a second WebSocket if one already exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      const firstWsInstance = wsInstance;
      // Call startWebSocket again directly while this.ws is still set
      (client as any).startWebSocket();

      // wsInstance should be unchanged - no new WS created
      expect(wsInstance).toBe(firstWsInstance);
      client.close();
    });

    it('should log error and schedule reconnect when WebSocket constructor throws', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
      const client = new TogglyServerClient(defaultConfig);

      // Make the WS constructor throw on the NEXT call (after init's first WS creation)
      const MockWs = require('ws') as jest.Mock;
      // First call (during init) will succeed with the default mock
      await client.init();
      client.close(); // clean up first WS

      jest.useFakeTimers();
      // Make the next WS constructor throw
      MockWs.mockImplementationOnce(() => {
        throw new Error('WS constructor failed');
      });

      // Trigger startWebSocket by firing the close-then-reconnect cycle
      (client as any).ws = null;
      (client as any).wsReconnectTimer = null;
      (client as any).startWebSocket();

      expect(console.error).toHaveBeenCalled();
      // A reconnect should be scheduled
      expect((client as any).wsReconnectTimer).not.toBeNull();

      jest.useRealTimers();
    });

    it('should fire reconnect timer callback and restart WebSocket', async () => {
      jest.useFakeTimers();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      // Trigger close → scheduleReconnect sets a 5s timer
      wsHandlers['close']?.();
      expect((client as any).wsReconnectTimer).not.toBeNull();

      // Advance past reconnect delay → timer fires, startWebSocket runs again
      jest.advanceTimersByTime(6000);
      expect((client as any).wsReconnectTimer).toBeNull();

      jest.useRealTimers();
      client.close();
    });

    it('should not schedule a second reconnect timer if one is already pending', async () => {
      jest.useFakeTimers();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      // First close fires scheduleReconnect → timer set
      wsHandlers['close']?.();
      const firstTimer = (client as any).wsReconnectTimer;
      expect(firstTimer).not.toBeNull();

      // Second call to scheduleReconnect while timer is pending should be a no-op
      (client as any).scheduleReconnect();
      expect((client as any).wsReconnectTimer).toBe(firstTimer);

      jest.useRealTimers();
      client.close();
    });
  });

  describe('close', () => {
    it('should close WebSocket and cleanup on close()', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      client.close();

      expect(wsInstance.close).toHaveBeenCalled();
      expect(wsInstance.removeAllListeners).toHaveBeenCalled();
    });

    it('should clear refresh timer on close()', async () => {
      const client = new TogglyServerClient(defaultConfig);
      // Simulate a refresh timer being set (normally set by polling logic)
      (client as any).refreshTimer = setInterval(() => {}, 99999);

      client.close();

      expect((client as any).refreshTimer).toBeNull();
    });

    it('should cancel pending reconnect timer on close()', async () => {
      jest.useFakeTimers();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
      const client = new TogglyServerClient(defaultConfig);
      await client.init();

      // Trigger a reconnect schedule
      wsHandlers['close']?.();
      // wsReconnectTimer should be set now
      expect((client as any).wsReconnectTimer).not.toBeNull();

      client.close();
      expect((client as any).wsReconnectTimer).toBeNull();

      jest.useRealTimers();
    });
  });
});

describe('createServerClient', () => {
  it('should create a TogglyServerClient instance', () => {
    const client = createServerClient({ appKey: 'test-key' });
    expect(client).toBeInstanceOf(TogglyServerClient);
  });
});
