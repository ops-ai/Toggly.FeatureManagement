import Toggly from './toggly.service';
import type { Hook } from '@ops-ai/toggly-hooks-types';

// Mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('Toggly Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ───────────────────────────────────────────────
  // Constructor
  // ───────────────────────────────────────────────
  describe('Constructor', () => {
    it('should use featureDefaults when no appKey provided', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults')
      );
    });

    it('should warn when no appKey and no featureDefaults', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new Toggly({});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('valid application key is required')
      );
    });

    it('should default environment to Production when appKey provided without env', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new Toggly({ appKey: 'test-key' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using Production environment')
      );
    });

    it('should accept appKey and environment without warning about env', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      new Toggly({ appKey: 'test-key', environment: 'Staging' });

      // Should NOT warn about production environment
      const envWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('Production environment')
      );
      expect(envWarns).toHaveLength(0);
    });

    it('should set shouldShowFeatureDuringEvaluation from config', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
        showFeatureDuringEvaluation: true,
      });

      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });

    it('should default shouldShowFeatureDuringEvaluation to false', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });

      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });

    it('should register hooks from config', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'InitHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should merge config with defaults', () => {
      const service = new Toggly({
        appKey: 'key',
        environment: 'Test',
      });

      // The base URI should be the default
      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // Feature Loading
  // ───────────────────────────────────────────────
  describe('_loadFeatures', () => {
    it('should return feature defaults when no appKey', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({ F1: true, F2: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch features from API when appKey is set', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ApiFlag: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({ ApiFlag: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-signed/test-key/Production'
      );
    });

    it('should include identity in API URL when set', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-signed/test-key/Production?u=user-123'
      );
    });

    it('should use custom baseURI when configured', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        baseURI: 'https://custom.api.com',
        appKey: 'test-key',
        environment: 'Staging',
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/evaluated-signed/test-key/Staging'
      );
    });

    it('should fall back to featureDefaults on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        featureDefaults: { Fallback: true },
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({ Fallback: true });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using cached/default features'),
      );
    });

    it('should fall back to empty object when no featureDefaults on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const features = await service._loadFeatures();
      expect(features).toEqual({});
    });

    it('should not make duplicate API calls during loading', async () => {
      let resolveFirst: (value: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      mockFetch.mockReturnValueOnce(
        slowPromise.then(() => ({
          json: () => Promise.resolve({ F1: true }),
        }))
      );

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      // Start two loads simultaneously
      const load1 = service._loadFeatures();
      const load2 = service._loadFeatures();

      // Resolve the fetch
      resolveFirst!(undefined);

      const [result1, result2] = await Promise.all([load1, load2]);

      expect(result1).toEqual({ F1: true });
      expect(result2).toEqual({ F1: true });
      // Only one fetch should have been made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return cached features on subsequent calls', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const first = await service._loadFeatures();
      const second = await service._loadFeatures();

      expect(first).toEqual({ F1: true });
      expect(second).toEqual({ F1: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should trigger afterRefresh hooks after loading', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      let refreshedFlags: any = null;
      const hook: Hook = {
        getMetadata: () => ({ name: 'RefreshHook', version: '1.0.0' }),
        afterRefresh: async (flags) => {
          refreshedFlags = flags;
        },
      };

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        hooks: [hook],
      });

      await service._loadFeatures();
      expect(refreshedFlags).toEqual({ F1: true });
    });
  });

  // ───────────────────────────────────────────────
  // _featuresLoaded
  // ───────────────────────────────────────────────
  describe('_featuresLoaded', () => {
    it('should return features if already loaded', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      // Features are loaded via constructor (featureDefaults)
      const features = await service._featuresLoaded();
      expect(features).toEqual({ F1: true });
    });

    it('should load features if not yet loaded', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ApiFlag: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const features = await service._featuresLoaded();
      expect(features).toEqual({ ApiFlag: true });
    });
  });

  // ───────────────────────────────────────────────
  // Feature Evaluation (_evaluateFeatureGate)
  // ───────────────────────────────────────────────
  describe('_evaluateFeatureGate', () => {
    let service: Toggly;

    beforeEach(() => {
      service = new Toggly({
        featureDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should return true when all flags are enabled (requirement: all)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'F3'],
        'all',
        false
      );
      expect(result).toBe(true);
    });

    it('should return falsy when some flags are disabled (requirement: all)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'F2'],
        'all',
        false
      );
      expect(result).toBeFalsy();
    });

    it('should return true when any flag is enabled (requirement: any)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'F2'],
        'any',
        false
      );
      expect(result).toBe(true);
    });

    it('should return false when no flag is enabled (requirement: any)', async () => {
      const result = await service._evaluateFeatureGate(
        ['F2'],
        'any',
        false
      );
      expect(result).toBe(false);
    });

    it('should negate the result', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1'],
        'all',
        true
      );
      expect(result).toBe(false);
    });

    it('should negate falsy to truthy', async () => {
      const result = await service._evaluateFeatureGate(
        ['F2'],
        'all',
        true
      );
      expect(result).toBeTruthy();
    });

    it('should return true for empty features object', async () => {
      const emptyService = new Toggly({
        featureDefaults: {},
      });

      const result = await emptyService._evaluateFeatureGate(
        ['F1'],
        'all',
        false
      );
      expect(result).toBe(true);
    });

    it('should treat unknown flags as falsy with all requirement', async () => {
      const result = await service._evaluateFeatureGate(
        ['Unknown'],
        'all',
        false
      );
      expect(result).toBeFalsy();
    });

    it('should treat unknown flags as falsy with any requirement', async () => {
      const result = await service._evaluateFeatureGate(
        ['Unknown'],
        'any',
        false
      );
      expect(result).toBeFalsy();
    });

    it('should default requirement to all', async () => {
      const result = await service._evaluateFeatureGate(['F1', 'F3']);
      expect(result).toBe(true);
    });

    it('should handle mixed known/unknown flags with any', async () => {
      const result = await service._evaluateFeatureGate(
        ['F1', 'Unknown'],
        'any',
        false
      );
      expect(result).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // evaluateFeatureGate (public, with hooks)
  // ───────────────────────────────────────────────
  describe('evaluateFeatureGate', () => {
    it('should evaluate gate with hooks for non-empty keys', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'GateHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(`before:${key}`);
        },
        afterEvaluation: async (key, _data, result) => {
          calls.push(`after:${key}:${result}`);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
        hooks: [hook],
      });

      const result = await service.evaluateFeatureGate(
        ['F1', 'F2'],
        'all',
        false
      );

      expect(result).toBeFalsy();
      expect(calls[0]).toBe('before:F1');
      expect(calls[1]).toContain('after:F1:');
    });

    it('should evaluate gate without hooks for empty keys', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'EmptyGateHook', version: '1.0.0' }),
        beforeEvaluation: async () => {
          calls.push('called');
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      const result = await service.evaluateFeatureGate([], 'all', false);

      // Empty gate with empty features → true; empty gate with non-empty features → true
      expect(calls).toHaveLength(0); // No hooks called for empty gate
    });

    it('should pass result to afterEvaluation hook', async () => {
      let hookResult: boolean | undefined;
      const hook: Hook = {
        getMetadata: () => ({ name: 'ResultHook', version: '1.0.0' }),
        afterEvaluation: async (_key, _data, result) => {
          hookResult = result;
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.evaluateFeatureGate(['F1'], 'all', false);
      expect(hookResult).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // isFeatureOn
  // ───────────────────────────────────────────────
  describe('isFeatureOn', () => {
    it('should return true for enabled feature', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      const service = new Toggly({
        featureDefaults: { F1: false },
      });

      expect(await service.isFeatureOn('F1')).toBe(false);
    });

    it('should return falsy for unknown feature', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOn('Unknown')).toBeFalsy();
    });

    it('should trigger before/after evaluation hooks', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'OnHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(`before:${key}`);
        },
        afterEvaluation: async (key) => {
          calls.push(`after:${key}`);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.isFeatureOn('F1');
      expect(calls).toEqual(['before:F1', 'after:F1']);
    });

    it('should load features from API before evaluation', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ RemoteFlag: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
      });

      const result = await service.isFeatureOn('RemoteFlag');
      expect(result).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // isFeatureOff
  // ───────────────────────────────────────────────
  describe('isFeatureOff', () => {
    it('should return true for disabled feature (negate)', async () => {
      const service = new Toggly({
        featureDefaults: { F1: false },
      });

      expect(await service.isFeatureOff('F1')).toBeTruthy();
    });

    it('should return false for enabled feature (negate)', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOff('F1')).toBe(false);
    });

    it('should trigger hooks', async () => {
      const calls: string[] = [];
      const hook: Hook = {
        getMetadata: () => ({ name: 'OffHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      };

      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [hook],
      });

      await service.isFeatureOff('F1');
      expect(calls).toContain('F1');
    });
  });

  // ───────────────────────────────────────────────
  // Hook Management
  // ───────────────────────────────────────────────
  describe('Hook Management', () => {
    it('should add hook dynamically', async () => {
      const calls: string[] = [];
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      service.addHook({
        getMetadata: () => ({ name: 'DynHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      });

      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should remove hook and return true', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      service.addHook({
        getMetadata: () => ({ name: 'ToRemove', version: '1.0.0' }),
      });

      expect(service.removeHook('ToRemove')).toBe(true);
    });

    it('should return false when removing non-existent hook', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      expect(service.removeHook('NonExistent')).toBe(false);
    });

    it('should stop calling removed hook', async () => {
      let callCount = 0;
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      service.addHook({
        getMetadata: () => ({ name: 'CountHook', version: '1.0.0' }),
        beforeEvaluation: async () => {
          callCount++;
        },
      });

      await service.isFeatureOn('F1');
      expect(callCount).toBe(1);

      service.removeHook('CountHook');
      await service.isFeatureOn('F1');
      expect(callCount).toBe(1); // No new calls
    });
  });

  // ───────────────────────────────────────────────
  // Edge Cases
  // ───────────────────────────────────────────────
  describe('Edge Cases', () => {
    it('should handle empty feature gate with features loaded', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
      });

      // Empty gate → returns true (since features exist but gate is empty,
      // _evaluateFeatureGate returns true for non-empty features with empty gate via reduce)
      const result = await service.evaluateFeatureGate([], 'all', false);
      expect(result).toBe(true);
    });

    it('should handle special characters in feature keys', async () => {
      const service = new Toggly({
        featureDefaults: {
          'Feature.With.Dots': true,
          'Feature-With-Dashes': false,
        },
      });

      expect(await service.isFeatureOn('Feature.With.Dots')).toBe(true);
      expect(await service.isFeatureOn('Feature-With-Dashes')).toBe(false);
    });

    it('should handle concurrent feature evaluations', async () => {
      const service = new Toggly({
        featureDefaults: { F1: true, F2: false },
      });

      const results = await Promise.all([
        service.isFeatureOn('F1'),
        service.isFeatureOn('F2'),
        service.isFeatureOff('F1'),
        service.isFeatureOff('F2'),
      ]);

      expect(results[0]).toBe(true); // F1 on
      expect(results[1]).toBe(false); // F2 on (false)
      expect(results[2]).toBe(false); // F1 off (negate true → false)
      expect(results[3]).toBeTruthy(); // F2 off (negate false → truthy)
    });
  });

  // ───────────────────────────────────────────────
  // WebSocket live updates
  // ───────────────────────────────────────────────
  describe('WebSocket live updates', () => {
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((error: Event) => void) | null = null;
      closeCalled = false;

      constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
      }

      close() {
        this.closeCalled = true;
      }
    }

    beforeEach(() => {
      MockWebSocket.instances = [];
      (global as any).WebSocket = MockWebSocket;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      delete (global as any).WebSocket;
    });

    it('should not start WebSocket when no appKey', () => {
      const service = new Toggly({ featureDefaults: { F1: true } });
      service.startWebSocket();
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('should not start WebSocket when enableLiveUpdates is false', () => {
      const service = new Toggly({ appKey: 'key', environment: 'Test', enableLiveUpdates: false });
      service.startWebSocket();
      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('should create WebSocket with wss:// URL', () => {
      const service = new Toggly({ appKey: 'my-key', environment: 'Production', featureDefaults: {} });
      service.startWebSocket();
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('wss://definitions.toggly.io/my-key/ws');
    });

    it('should create ws:// URL for http:// baseURI', () => {
      const service = new Toggly({ appKey: 'k', baseURI: 'http://local', featureDefaults: {} });
      service.startWebSocket();
      expect(MockWebSocket.instances[0].url).toBe('ws://local/k/ws');
    });

    it('should set _wsConnected=true on open', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: {} });
      service.startWebSocket();
      MockWebSocket.instances[0].onopen?.();
      expect(service._wsConnected).toBe(true);
    });

    it('should handle flags-updated JSON message by resetting features', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'flags-updated' }) });
      expect((service as any)._features).toBeNull();
    });

    it('should handle update JSON message by resetting features', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'update' }) });
      expect((service as any)._features).toBeNull();
    });

    it('should ignore ping JSON message', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'ping' }) });
      expect((service as any)._features).toEqual({ F1: true });
    });

    it('should ignore unknown JSON message type', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'unknown' }) });
      expect((service as any)._features).toEqual({ F1: true });
    });

    it('should handle plain text update message', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: 'update' });
      expect((service as any)._features).toBeNull();
    });

    it('should handle plain text flags-updated message', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: 'flags-updated' });
      expect((service as any)._features).toBeNull();
    });

    it('should ignore unrecognized plain text', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service.startWebSocket();
      MockWebSocket.instances[0].onmessage?.({ data: 'hello' });
      expect((service as any)._features).toEqual({ F1: true });
    });

    it('should log error on WebSocket onerror', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: {} });
      service.startWebSocket();
      MockWebSocket.instances[0].onerror?.(new Event('error'));
      expect(console.error).toHaveBeenCalledWith('[Toggly] WebSocket error:', expect.anything());
    });

    it('should schedule reconnect on close', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: {} });
      service.startWebSocket();
      MockWebSocket.instances[0].onclose?.();
      expect(service._wsConnected).toBe(false);
      expect(service._ws).toBeNull();
      jest.runAllTimers();
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('should stopWebSocket: close ws and clear state', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: {} });
      service.startWebSocket();
      const ws = MockWebSocket.instances[0];
      service.stopWebSocket();
      expect(ws.closeCalled).toBe(true);
      expect(service._wsConnected).toBe(false);
      expect(service._ws).toBeNull();
    });

    it('should stopWebSocket: cancel pending reconnect timer', () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: {} });
      service.startWebSocket();
      MockWebSocket.instances[0].onclose?.(); // sets reconnect timer
      service.stopWebSocket(); // should cancel the timer
      jest.runAllTimers();
      expect(MockWebSocket.instances).toHaveLength(1); // no new WS after cancel
    });

    it('should throttle HTTP when WS connected and refresh was recent', async () => {
      const service = new Toggly({ appKey: 'k', featureDefaults: { F1: true } });
      (service as any)._features = { F1: true };
      service._wsConnected = true;
      service._lastFallbackRefresh = Date.now();
      mockFetch.mockResolvedValue({ json: () => Promise.resolve({ F1: false }) });

      await service._loadFeatures();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Variants and refresh subscriptions', () => {
    it('should fetch evaluated-variants-signed when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            defs: {
              V: { enabled: true, variant: 'A', configurationValue: { x: 1 } },
            },
          }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/test-key/Production',
      );
      expect(service.getVariant('V')).toEqual({ name: 'A', configurationValue: { x: 1 } });
      expect(service.getVariantValue('V')).toEqual({ x: 1 });
    });

    it('should pass userId query when enableVariants and identity are set', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ defs: {} }),
      });

      const service = new Toggly({
        appKey: 'k',
        environment: 'Production',
        enableVariants: true,
        identity: 'user@x',
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('userId=user%40x'),
      );
    });

    it('getVariant returns null when enableVariants is false', () => {
      const service = new Toggly({
        featureDefaults: { F: true },
      });
      expect(service.getVariant('F')).toBeNull();
      expect(service.getVariantValue('F')).toBeNull();
    });

    it('subscribeFeaturesRefresh runs after successful load', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        enableLiveUpdates: false,
      });

      const fn = jest.fn();
      service.subscribeFeaturesRefresh(fn);
      await service._loadFeatures();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('subscribeFeaturesRefresh can be unsubscribed', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 'test-key',
        environment: 'Production',
        enableLiveUpdates: false,
      });

      const fn = jest.fn();
      const unsub = service.subscribeFeaturesRefresh(fn);
      await service._loadFeatures();
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      await (service as any)._refreshFeatures();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('falls back to cached variants on API error when enableVariants', async () => {
      const appKey = 'test-key';
      const env = 'Production';
      const defs = { V: { enabled: true, variant: 'cached' } };
      localStorage.setItem(
        `toggly:variants:${appKey}:${env}`,
        JSON.stringify(defs),
      );
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const service = new Toggly({
        appKey,
        environment: env,
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(service.getVariant('V')).toEqual({
        name: 'cached',
        configurationValue: undefined,
      });
    });

    it('getVariant returns null when enabled but no variant name on def', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ defs: { V: { enabled: true } } }),
      });

      const service = new Toggly({
        appKey: 'k',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(service.getVariant('V')).toBeNull();
    });

    it('subscribeFeaturesRefresh continues when a listener throws', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly({
        appKey: 't',
        environment: 'Production',
        enableLiveUpdates: false,
      });

      const ok = jest.fn();
      service.subscribeFeaturesRefresh(() => {
        throw new Error('bad listener');
      });
      service.subscribeFeaturesRefresh(ok);
      await service._loadFeatures();
      expect(ok).toHaveBeenCalledTimes(1);
    });
  });
});
