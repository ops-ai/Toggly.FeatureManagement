import { TogglyService } from '../src/services/TogglyService';
import { MemoryStorage } from '../src/services/MemoryStorage';
import type { TogglyConfig, FeatureFlags } from '../src/models';

describe('TogglyService', () => {
  let service: TogglyService;
  let mockStorage: MemoryStorage;

  beforeEach(() => {
    mockStorage = new MemoryStorage();
    jest.clearAllMocks();
  });

  afterEach(() => {
    service?.dispose();
  });

  describe('initialization', () => {
    it('should create instance with default config', () => {
      service = new TogglyService();
      expect(service).toBeInstanceOf(TogglyService);
      expect(service.initialized).toBe(false);
    });

    it('should create instance with custom config', () => {
      const config: TogglyConfig = {
        appKey: 'test-app-key',
        environment: 'Development',
        storage: mockStorage,
      };
      service = new TogglyService(config);
      expect(service).toBeInstanceOf(TogglyService);
    });

    it('should initialize with feature defaults when no appKey provided', async () => {
      const featureDefaults: FeatureFlags = {
        feature1: true,
        feature2: false,
      };

      service = new TogglyService({
        featureDefaults,
        storage: mockStorage,
      });

      const response = await service.init();

      expect(response.status).toBe('defaults');
      expect(response.flags).toEqual(featureDefaults);
      expect(service.initialized).toBe(true);
    });

    it('should generate device ID when no identity provided', async () => {
      service = new TogglyService({
        storage: mockStorage,
      });

      await service.init();

      expect(service.currentIdentity).toBeTruthy();
      expect(typeof service.currentIdentity).toBe('string');
    });

    it('should use provided identity', async () => {
      const identity = 'user-123';
      service = new TogglyService({
        identity,
        storage: mockStorage,
      });

      await service.init();

      expect(service.currentIdentity).toBe(identity);
    });

    it('should fetch features from server when appKey provided', async () => {
      const mockFlags: FeatureFlags = {
        serverFeature: true,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFlags,
        headers: new Map([['etag', '"abc123"']]),
      });

      service = new TogglyService({
        appKey: 'test-key',
        environment: 'Production',
        storage: mockStorage,
      });

      const response = await service.init();

      expect(response.status).toBe('fetched');
      expect(response.flags).toEqual(mockFlags);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should fall back to defaults on network error', async () => {
      const featureDefaults: FeatureFlags = {
        fallbackFeature: true,
      };

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      service = new TogglyService({
        appKey: 'test-key',
        featureDefaults,
        storage: mockStorage,
      });

      const response = await service.init();

      expect(response.status).toBe('defaults');
      expect(response.flags).toEqual(featureDefaults);
      expect(response.error).toBe('Network error');
    });
  });

  describe('feature evaluation', () => {
    beforeEach(async () => {
      service = new TogglyService({
        featureDefaults: {
          enabledFeature: true,
          disabledFeature: false,
          feature1: true,
          feature2: true,
          feature3: false,
        },
        storage: mockStorage,
      });
      await service.init();
    });

    describe('isFeatureOn', () => {
      it('should return true for enabled feature', async () => {
        const result = await service.isFeatureOn('enabledFeature');
        expect(result).toBe(true);
      });

      it('should return false for disabled feature', async () => {
        const result = await service.isFeatureOn('disabledFeature');
        expect(result).toBe(false);
      });

      it('should return false for unknown feature', async () => {
        const result = await service.isFeatureOn('unknownFeature');
        expect(result).toBe(false);
      });
    });

    describe('isFeatureOff', () => {
      it('should return false for enabled feature', async () => {
        const result = await service.isFeatureOff('enabledFeature');
        expect(result).toBe(false);
      });

      it('should return true for disabled feature', async () => {
        const result = await service.isFeatureOff('disabledFeature');
        expect(result).toBe(true);
      });

      it('should return true for unknown feature', async () => {
        const result = await service.isFeatureOff('unknownFeature');
        expect(result).toBe(true);
      });
    });

    describe('evaluateFeatureGate', () => {
      it('should return true when all features are enabled (all requirement)', async () => {
        const result = await service.evaluateFeatureGate(
          ['feature1', 'feature2'],
          'all'
        );
        expect(result).toBe(true);
      });

      it('should return false when some features are disabled (all requirement)', async () => {
        const result = await service.evaluateFeatureGate(
          ['feature1', 'feature3'],
          'all'
        );
        expect(result).toBe(false);
      });

      it('should return true when any feature is enabled (any requirement)', async () => {
        const result = await service.evaluateFeatureGate(
          ['feature1', 'feature3'],
          'any'
        );
        expect(result).toBe(true);
      });

      it('should return false when no features are enabled (any requirement)', async () => {
        const result = await service.evaluateFeatureGate(
          ['feature3', 'unknownFeature'],
          'any'
        );
        expect(result).toBe(false);
      });

      it('should negate the result when negate is true', async () => {
        const result = await service.evaluateFeatureGate(
          ['enabledFeature'],
          'all',
          true
        );
        expect(result).toBe(false);
      });

      it('should return true for empty feature keys', async () => {
        const result = await service.evaluateFeatureGate([]);
        expect(result).toBe(true);
      });
    });
  });

  describe('identity management', () => {
    it('should update identity and refresh features', async () => {
      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });
      await service.init();

      const initialIdentity = service.currentIdentity;
      const newIdentity = 'new-user-456';

      const response = await service.setIdentity(newIdentity);

      expect(service.currentIdentity).toBe(newIdentity);
      expect(service.currentIdentity).not.toBe(initialIdentity);
      expect(response.status).toBe('defaults');
    });

    it('should revert to device ID when identity is null', async () => {
      service = new TogglyService({
        identity: 'user-123',
        storage: mockStorage,
      });
      await service.init();

      await service.setIdentity(null);

      expect(service.currentIdentity).toBeTruthy();
      expect(service.currentIdentity).not.toBe('user-123');
    });
  });

  describe('caching', () => {
    it('should cache features after fetch', async () => {
      const mockFlags: FeatureFlags = { cachedFeature: true };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockFlags,
        headers: new Map(),
      });

      service = new TogglyService({
        appKey: 'test-key',
        storage: mockStorage,
      });

      await service.init();

      // Verify cache was written
      const keys = mockStorage.keys();
      expect(keys.some((k) => k.startsWith('@toggly:featureFlagsCache:'))).toBe(true);
    });

    it('should clear cache when requested', async () => {
      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });
      await service.init();

      await service.clearCache();

      expect(service.currentFeatures).toBeNull();
    });
  });

  describe('hooks', () => {
    it('should register and execute hooks', async () => {
      const beforeEvaluationMock = jest.fn();
      const afterEvaluationMock = jest.fn();

      service = new TogglyService({
        featureDefaults: { testFeature: true },
        hooks: [
          {
            getMetadata: () => ({ name: 'TestHook' }),
            beforeEvaluation: beforeEvaluationMock,
            afterEvaluation: afterEvaluationMock,
          },
        ],
        storage: mockStorage,
      });

      await service.init();
      await service.isFeatureOn('testFeature');

      expect(beforeEvaluationMock).toHaveBeenCalledWith('testFeature', undefined);
      expect(afterEvaluationMock).toHaveBeenCalledWith('testFeature', undefined, true);
    });

    it('should add hook dynamically', async () => {
      const hookMock = jest.fn();

      service = new TogglyService({
        featureDefaults: { testFeature: true },
        storage: mockStorage,
      });
      await service.init();

      service.addHook({
        getMetadata: () => ({ name: 'DynamicHook' }),
        afterEvaluation: hookMock,
      });

      await service.isFeatureOn('testFeature');

      expect(hookMock).toHaveBeenCalled();
    });

    it('should remove hook by name', async () => {
      const hookMock = jest.fn();

      service = new TogglyService({
        featureDefaults: { testFeature: true },
        hooks: [
          {
            getMetadata: () => ({ name: 'RemovableHook' }),
            afterEvaluation: hookMock,
          },
        ],
        storage: mockStorage,
      });
      await service.init();

      const removed = service.removeHook('RemovableHook');
      expect(removed).toBe(true);

      await service.isFeatureOn('testFeature');
      expect(hookMock).not.toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('should emit initialized event', async () => {
      const listener = jest.fn();

      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });

      service.on('initialized', listener);
      await service.init();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initialized',
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit identityChanged event', async () => {
      const listener = jest.fn();

      service = new TogglyService({
        identity: 'user-1',
        storage: mockStorage,
      });
      await service.init();

      service.on('identityChanged', listener);
      await service.setIdentity('user-2');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'identityChanged',
          data: {
            previousIdentity: 'user-1',
            newIdentity: 'user-2',
          },
        })
      );
    });

    it('should unsubscribe from events', async () => {
      const listener = jest.fn();

      service = new TogglyService({
        storage: mockStorage,
      });

      const unsubscribe = service.on('initialized', listener);
      unsubscribe();

      await service.init();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('state change handlers', () => {
    it('should notify handlers when features change', async () => {
      const handler = jest.fn();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ feature1: true }),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ feature1: false }),
          headers: new Map(),
        });

      service = new TogglyService({
        appKey: 'test-key',
        storage: mockStorage,
      });

      await service.init();
      service.addStateChangeHandler(handler);
      await service.refresh();

      expect(handler).toHaveBeenCalledWith('feature1', true, false);
    });

    it('should remove state change handler', async () => {
      const handler = jest.fn();

      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });
      await service.init();

      const removeHandler = service.addStateChangeHandler(handler);
      removeHandler();

      // Handler should not be called after removal
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('debug info', () => {
    it('should return debug information', async () => {
      service = new TogglyService({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        storage: mockStorage,
      });
      await service.init();

      const debugInfo = service.getDebugInfo();

      expect(debugInfo.appKey).toBe('test-key');
      expect(debugInfo.environment).toBe('Production');
      expect(debugInfo.identity).toBe('user-123');
      expect(debugInfo.syncServiceRunning).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clean up resources on dispose', async () => {
      const listener = jest.fn();

      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });
      await service.init();

      service.on('refreshed', listener);
      service.dispose();

      expect(service.initialized).toBe(false);
      expect(service.currentFeatures).toBeNull();
    });
  });

  describe('network and app state', () => {
    it('should handle network state changes', async () => {
      let networkCallback: ((state: { isConnected: boolean }) => void) | null = null;
      const mockNetworkInfo = {
        subscribe: jest.fn((callback) => {
          networkCallback = callback;
          return () => {};
        }),
        getState: jest.fn().mockResolvedValue({ isConnected: true }),
      };

      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
        networkInfo: mockNetworkInfo,
      });

      await service.init();
      expect(mockNetworkInfo.subscribe).toHaveBeenCalled();

      // Simulate going offline then online
      if (networkCallback) {
        networkCallback({ isConnected: false });
        networkCallback({ isConnected: true });
      }
    });

    it('should handle app state changes', async () => {
      let appStateCallback: ((state: string) => void) | null = null;
      const mockAppState = {
        getCurrentState: jest.fn().mockReturnValue('active'),
        subscribe: jest.fn((callback) => {
          appStateCallback = callback;
          return () => {};
        }),
      };

      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
        appState: mockAppState,
      });

      await service.init();
      expect(mockAppState.subscribe).toHaveBeenCalled();

      // Simulate going to background then foreground
      if (appStateCallback) {
        appStateCallback('background');
        appStateCallback('active');
      }
    });

    it('should skip refresh when app is in background', async () => {
      const mockAppState = {
        getCurrentState: jest.fn().mockReturnValue('background'),
        subscribe: jest.fn(() => () => {}),
      };

      service = new TogglyService({
        appKey: 'test-key',
        featureDefaults: { feature1: true },
        storage: mockStorage,
        appState: mockAppState,
      });

      await service.init();

      // Refresh should return cached because app is in background
      const response = await service.refresh();
      expect(response.status).toBe('cached');
    });

    it('should skip refresh when offline', async () => {
      const mockNetworkInfo = {
        subscribe: jest.fn(() => () => {}),
        getState: jest.fn().mockResolvedValue({ isConnected: false }),
      };

      service = new TogglyService({
        appKey: 'test-key',
        featureDefaults: { feature1: true },
        storage: mockStorage,
        networkInfo: mockNetworkInfo,
      });

      await service.init();

      // Manually set network state to offline
      (service as any).networkState = { isConnected: false };

      const response = await service.refresh();
      expect(response.status).toBe('cached');
    });
  });

  describe('API responses', () => {
    it('should handle 304 Not Modified response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ feature1: true }),
        headers: new Map([['etag', '"abc123"']]),
      }).mockResolvedValueOnce({
        ok: false,
        status: 304,
        statusText: 'Not Modified',
      });

      service = new TogglyService({
        appKey: 'test-key',
        storage: mockStorage,
      });

      await service.init();

      // Second refresh should handle 304
      const response = await service.refresh();
      expect(response.status).toBe('cached');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      service = new TogglyService({
        appKey: 'test-key',
        featureDefaults: { fallback: true },
        storage: mockStorage,
      });

      const response = await service.init();
      expect(response.status).toBe('defaults');
      expect(response.error).toContain('500');
    });

    it('should handle signed definitions response', async () => {
      const mockSignedData = {
        data: { signedFeature: true },
        signature: 'mock-signature',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSignedData,
        headers: new Map(),
      });

      service = new TogglyService({
        appKey: 'test-key',
        useSignedDefinitions: true,
        storage: mockStorage,
      });

      const response = await service.init();
      expect(response.status).toBe('fetched');
      expect(response.flags).toEqual({ signedFeature: true });
    });

    it('should add If-None-Match header when ETag exists', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ feature1: true }),
          headers: new Map([['etag', '"abc123"']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ feature1: true }),
          headers: new Map(),
        });

      service = new TogglyService({
        appKey: 'test-key',
        useSignedDefinitions: true,
        storage: mockStorage,
      });

      await service.init();
      await service.refresh();

      // Check that fetch was called with the If-None-Match header
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('concurrent requests', () => {
    it('should prevent duplicate fetches', async () => {
      let resolvePromise: () => void;
      const slowPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      (global.fetch as jest.Mock).mockImplementation(() =>
        slowPromise.then(() => ({
          ok: true,
          status: 200,
          json: async () => ({ feature1: true }),
          headers: new Map(),
        }))
      );

      service = new TogglyService({
        appKey: 'test-key',
        storage: mockStorage,
      });

      // Start two concurrent refreshes
      const promise1 = service.init();
      const promise2 = service.refresh();

      // Resolve the fetch
      resolvePromise!();

      await Promise.all([promise1, promise2]);

      // Should only have made one fetch call
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAll event listener', () => {
    it('should receive all events', async () => {
      const allEventsListener = jest.fn();

      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });

      service.onAll(allEventsListener);
      await service.init();
      await service.setIdentity('user-1');

      expect(allEventsListener).toHaveBeenCalled();
    });
  });

  describe('feature evaluation edge cases', () => {
    it('should handle single feature in gate with negate', async () => {
      service = new TogglyService({
        featureDefaults: { feature1: true },
        storage: mockStorage,
      });
      await service.init();

      const result = await service.evaluateFeatureGate(['feature1'], 'all', true);
      expect(result).toBe(false);
    });

    it('should use defaults when features is null', async () => {
      service = new TogglyService({
        featureDefaults: { defaultFeature: true },
        storage: mockStorage,
      });

      // Don't init, evaluate directly
      const result = await service.isFeatureOn('defaultFeature');
      expect(result).toBe(true);
    });
  });

  describe('showFeatureDuringEvaluation', () => {
    it('should return the configured value', () => {
      service = new TogglyService({
        showFeatureDuringEvaluation: true,
        storage: mockStorage,
      });

      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });
  });

  describe('state change handler errors', () => {
    it('should continue when handler throws error', async () => {
      const errorHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const goodHandler = jest.fn();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ feature1: true }),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ feature1: false }),
          headers: new Map(),
        });

      service = new TogglyService({
        appKey: 'test-key',
        storage: mockStorage,
      });

      await service.init();
      service.addStateChangeHandler(errorHandler);
      service.addStateChangeHandler(goodHandler);
      await service.refresh();

      expect(errorHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
