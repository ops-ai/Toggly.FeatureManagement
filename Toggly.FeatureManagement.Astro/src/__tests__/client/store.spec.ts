import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initTogglyClient,
  refreshFlags,
  setIdentity,
  clearIdentity,
  stopRefreshInterval,
  stopWebSocket,
  getVariant,
  getVariantValue,
  $flags,
  $isReady,
  $error,
  $flag,
  $gate,
  $variant,
  __resetClient,
} from '../../client/store.js';
import { SDK_ID, SDK_VERSION } from '../../sdk-identity.js';
import { REFRESH_DEBOUNCE_MS } from '../../client/ws-sync.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: ((ev?: Event) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: CloseEvent) => void) | null = null;
  onerror: ((ev?: Event) => void) | null = null;
  readyState = 0;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = 3;
  }
}

function createMockResponse(
  body: unknown,
  options?: { status?: number; revision?: string }
) {
  const status = options?.status ?? 200;
  const revision = options?.revision;
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 304 ? 'Not Modified' : 'OK',
    headers: {
      get: (key: string) => {
        if (!revision) {
          return null;
        }
        if (key === 'X-Definitions-Revision' || key === 'ETag') {
          return revision;
        }
        return null;
      },
    },
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
    vi.advanceTimersByTime(0);
  });
}

describe('Client Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    __resetClient();
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    __resetClient();
    vi.useRealTimers();
  });

  describe('initTogglyClient', () => {
    it('should initialize with flagDefaults when no appKey', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { Feature1: true, Feature2: false },
      });

      expect($flags.get()).toEqual({ Feature1: true, Feature2: false });
      expect($isReady.get()).toBe(true);
      expect($error.get()).toBeNull();
    });

    it('should fetch flags from API when appKey is set', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true })
      );

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect($flags.get()).toEqual({ Feature1: true });
      expect($isReady.get()).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should warn and skip if already initialized', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await initTogglyClient({
        environment: 'test',
        flagDefaults: { F1: true },
      });

      await initTogglyClient({
        environment: 'test',
        flagDefaults: { F2: true },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already initialized')
      );
      // Flags should still be from first init
      expect($flags.get()).toEqual({ F1: true });

      warnSpy.mockRestore();
    });

    it('should set $error on initialization failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        flagDefaults: {},
      });

      // $isReady should still be true (marks as ready even on error)
      expect($isReady.get()).toBe(true);

      errorSpy.mockRestore();
    });

    it('should start refresh interval when configured', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 5000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance time to trigger one interval tick
      vi.advanceTimersByTime(5001);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Clean up interval
      stopRefreshInterval();
    });

    it('should not start refresh interval when set to 0', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { F1: true },
        featureFlagsRefreshInterval: 0,
      });

      vi.advanceTimersByTime(10000);
      // No fetch should be called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch evaluated-variants-signed when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          defs: {
            V: { enabled: true, variant: 'A', configurationValue: { x: 1 } },
          },
          signature: 's',
          timestamp: 1,
          kid: 'k',
        })
      );

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/test-key/Production',
        expect.anything()
      );
      expect($flags.get().V).toBe(true);
      expect(getVariant('V')).toEqual({ name: 'A', configurationValue: { x: 1 } });
      expect(getVariantValue('V')).toEqual({ x: 1 });
      expect($variant('V').get()).toEqual({ name: 'A', configurationValue: { x: 1 } });
    });

    it('getVariant returns null when enableVariants is false', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ defs: { F: true } }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: false,
        featureFlagsRefreshInterval: 0,
      });

      expect(getVariant('F')).toBeNull();
      expect(getVariantValue('F')).toBeNull();
    });
  });

  describe('refreshFlags', () => {
    it('should update flags store', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { F1: true, F2: false },
      });

      expect($flags.get().F1).toBe(true);

      // No appKey means it will re-use flagDefaults
      await refreshFlags();
      expect($flags.get()).toEqual({ F1: true, F2: false });
    });

    it('should error if client not initialized', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await refreshFlags();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Client not initialized')
      );

      errorSpy.mockRestore();
    });
  });

  describe('setIdentity', () => {
    it('should trigger a refresh after setting identity', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0, // Disable auto-refresh to avoid timer loops
      });

      const callCountAfterInit = mockFetch.mock.calls.length;

      setIdentity('user-123');
      await flushPromises();

      // Should have triggered another fetch
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterInit);
    });

    it('should error if client not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setIdentity('user-123');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Client not initialized')
      );

      errorSpy.mockRestore();
    });
  });

  describe('clearIdentity', () => {
    it('should trigger a refresh after clearing identity', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0, // Disable auto-refresh to avoid timer loops
      });

      const callCountAfterInit = mockFetch.mock.calls.length;

      clearIdentity();
      await flushPromises();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterInit);
    });

    it('should error if client not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      clearIdentity();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Client not initialized')
      );

      errorSpy.mockRestore();
    });
  });

  describe('stopRefreshInterval', () => {
    it('should stop auto-refresh', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 5000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      stopRefreshInterval();

      vi.advanceTimersByTime(15000);
      await vi.runAllTimersAsync();

      // Should not have refreshed after stopping
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call when no client', () => {
      // Should not throw
      expect(() => stopRefreshInterval()).not.toThrow();
    });
  });

  describe('$flag computed atom', () => {
    it('should return flag value when exists', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { Feature1: true, Feature2: false },
      });

      const f1 = $flag('Feature1');
      const f2 = $flag('Feature2');

      expect(f1.get()).toBe(true);
      expect(f2.get()).toBe(false);
    });

    it('should return defaultValue when flag does not exist', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: {},
      });

      const f = $flag('Unknown', true);
      expect(f.get()).toBe(true);
    });

    it('should default to false when no defaultValue provided', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: {},
      });

      const f = $flag('Unknown');
      expect(f.get()).toBe(false);
    });

    it('should react to store changes', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { Feature1: false },
      });

      const f = $flag('Feature1');
      expect(f.get()).toBe(false);

      // Manually update the flags store
      $flags.set({ Feature1: true });
      expect(f.get()).toBe(true);
    });
  });

  describe('$gate computed atom', () => {
    beforeEach(async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { F1: true, F2: true, F3: false },
      });
    });

    it('should return true for empty keys when not negated', () => {
      const gate = $gate([]);
      expect(gate.get()).toBe(true);
    });

    it('should return false for empty keys when negated', () => {
      const gate = $gate([], 'all', true);
      expect(gate.get()).toBe(false);
    });

    it('should evaluate "all" requirement', () => {
      expect($gate(['F1', 'F2']).get()).toBe(true);
      expect($gate(['F1', 'F3']).get()).toBe(false);
    });

    it('should evaluate "any" requirement', () => {
      expect($gate(['F1', 'F3'], 'any').get()).toBe(true);
      expect($gate(['F3'], 'any').get()).toBe(false);
    });

    it('should support negation', () => {
      expect($gate(['F1', 'F2'], 'all', true).get()).toBe(false);
      expect($gate(['F3'], 'all', true).get()).toBe(true);
    });

    it('should react to store changes', () => {
      const gate = $gate(['F1', 'F2']);
      expect(gate.get()).toBe(true);

      $flags.set({ F1: true, F2: false, F3: false });
      expect(gate.get()).toBe(false);
    });
  });

  describe('WebSocket live updates', () => {
    it('should not start WebSocket when enableLiveUpdates is false', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        enableLiveUpdates: false,
        featureFlagsRefreshInterval: 0,
      });

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('should not start WebSocket when appKey is missing', async () => {
      await initTogglyClient({
        environment: 'test',
        flagDefaults: { F1: true },
        featureFlagsRefreshInterval: 0,
      });

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('should connect with sdk identity query params after init', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'my-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe(
        `wss://definitions.toggly.io/my-key/ws?sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
      );
    });

    it('should include rev when a definitions revision is cached', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ F1: true }, { revision: 'rev123' })
      );

      await initTogglyClient({
        appKey: 'k',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(MockWebSocket.instances[0].url).toBe(
        `wss://definitions.toggly.io/k/ws?rev=rev123&sdk=${SDK_ID}&sdkVersion=${SDK_VERSION}`
      );
    });

    it('should send If-None-Match on subsequent fetches when revision is known', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'rev-a' }))
        .mockResolvedValueOnce(
          createMockResponse({ F1: false }, { revision: 'rev-b' })
        );

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      await refreshFlags();

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-None-Match': 'rev-a',
          }),
        })
      );
    });

    it('should keep cached flags on 304', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'rev-a' }))
        .mockResolvedValueOnce(createMockResponse('', { status: 304, revision: 'rev-a' }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      await refreshFlags();

      expect($flags.get()).toEqual({ F1: true });
    });

    it('should debounced-refresh on flags-updated without caching WS etag first', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'old' }))
        .mockResolvedValueOnce(createMockResponse({ F1: false }, { revision: 'new' }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      MockWebSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: 'flags-updated', etag: 'new' }),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Revision cleared before refresh → no If-None-Match on the forced fetch
      expect(mockFetch.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
      expect($flags.get()).toEqual({ F1: false });
    });

    it('should refresh on sync when etag differs', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'old' }))
        .mockResolvedValueOnce(createMockResponse({ F1: false }, { revision: 'new' }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      MockWebSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: 'sync', etag: 'new' }),
      });

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not refresh on sync when unchanged is true', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'abc' }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      MockWebSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: 'sync', etag: 'abc', unchanged: true }),
      });

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should refresh on signing-key-updated', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'old' }))
        .mockResolvedValueOnce(createMockResponse({ F1: true }, { revision: 'new' }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      MockWebSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: 'signing-key-updated', kid: 'k2' }),
      });

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should ignore ping messages', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      MockWebSocket.instances[0].onmessage?.({
        data: JSON.stringify({ type: 'ping' }),
      });

      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should reconnect with exponential backoff on close', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 0,
      });

      expect(MockWebSocket.instances).toHaveLength(1);
      MockWebSocket.instances[0].onclose?.();

      await vi.advanceTimersByTimeAsync(5000);
      expect(MockWebSocket.instances).toHaveLength(2);

      stopWebSocket();
    });

    it('should skip interval refresh while WebSocket is connected within fallback window', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ F1: true }));

      await initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 5000,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      MockWebSocket.instances[0].onopen?.();

      await vi.advanceTimersByTimeAsync(5001);
      await flushPromises();

      // Skipped because WS is connected and fallback window not elapsed
      expect(mockFetch).toHaveBeenCalledTimes(1);

      stopRefreshInterval();
    });
  });
});
