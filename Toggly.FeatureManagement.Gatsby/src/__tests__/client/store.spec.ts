import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SDK_VERSION } from '../../sdk-identity.js';

// We use dynamic imports via vi.resetModules() to get a fresh clientInstance for each test
type StoreModule = typeof import('../../client/store.js');

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  url: string;

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data });
  }

  triggerClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

let wsInstances: MockWebSocket[] = [];

function latestWs(): MockWebSocket {
  return wsInstances[wsInstances.length - 1];
}

function mockOkResponse(flags: Record<string, boolean>, revision?: string): Response {
  const body = JSON.stringify(flags);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (key: string) => {
        if (revision && (key === 'ETag' || key === 'X-Definitions-Revision')) {
          return revision;
        }
        return null;
      },
    },
    text: async () => body,
    json: async () => flags,
  } as Response;
}

describe('Client Store', () => {
  let store: StoreModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    wsInstances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    store = await import('../../client/store.js');
  });

  afterEach(() => {
    store.stopRefreshInterval();
    store.stopWebSocket();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ─── Atoms ──────────────────────
  describe('atoms', () => {
    it('$flags should initialize as empty object', () => {
      expect(store.$flags.get()).toEqual({});
    });

    it('$isReady should initialize as false', () => {
      expect(store.$isReady.get()).toBe(false);
    });

    it('$error should initialize as null', () => {
      expect(store.$error.get()).toBeNull();
    });
  });

  // ─── $flag ──────────────────────
  describe('$flag', () => {
    it('should return correct flag value', () => {
      store.$flags.set({ F1: true, F2: false });
      const f1 = store.$flag('F1');
      expect(f1.get()).toBe(true);
    });

    it('should return default value for missing flag', () => {
      store.$flags.set({ F1: true });
      const missing = store.$flag('Unknown', true);
      expect(missing.get()).toBe(true);
    });

    it('should return false as default when not specified', () => {
      store.$flags.set({});
      const missing = store.$flag('Unknown');
      expect(missing.get()).toBe(false);
    });

    it('should reactively update when flags change', () => {
      const f1 = store.$flag('F1');
      expect(f1.get()).toBe(false);

      store.$flags.set({ F1: true });
      expect(f1.get()).toBe(true);

      store.$flags.set({ F1: false });
      expect(f1.get()).toBe(false);
    });
  });

  // ─── $gate ──────────────────────
  describe('$gate', () => {
    it('should evaluate "all" requirement', () => {
      store.$flags.set({ F1: true, F2: true });
      const gate = store.$gate(['F1', 'F2'], 'all');
      expect(gate.get()).toBe(true);
    });

    it('should fail "all" when one flag is false', () => {
      store.$flags.set({ F1: true, F2: false });
      const gate = store.$gate(['F1', 'F2'], 'all');
      expect(gate.get()).toBe(false);
    });

    it('should evaluate "any" requirement', () => {
      store.$flags.set({ F1: true, F2: false });
      const gate = store.$gate(['F1', 'F2'], 'any');
      expect(gate.get()).toBe(true);
    });

    it('should fail "any" when all flags are false', () => {
      store.$flags.set({ F1: false, F2: false });
      const gate = store.$gate(['F1', 'F2'], 'any');
      expect(gate.get()).toBe(false);
    });

    it('should support negate', () => {
      store.$flags.set({ F1: true });
      const gate = store.$gate(['F1'], 'all', true);
      expect(gate.get()).toBe(false);
    });

    it('should return true for empty keys without negate', () => {
      const gate = store.$gate([], 'all');
      expect(gate.get()).toBe(true);
    });

    it('should return false for empty keys with negate', () => {
      const gate = store.$gate([], 'all', true);
      expect(gate.get()).toBe(false);
    });

    it('should default to "all" requirement', () => {
      store.$flags.set({ F1: true, F2: true });
      const gate = store.$gate(['F1', 'F2']);
      expect(gate.get()).toBe(true);
    });
  });

  // ─── initTogglyClient ──────────────────────
  describe('initTogglyClient', () => {
    it('should initialize with flag defaults when no appKey', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));

      await store.initTogglyClient({
        appKey: '',
        flagDefaults: { F1: true, F2: false },
      });

      expect(store.$flags.get()).toEqual({ F1: true, F2: false });
      expect(store.$isReady.get()).toBe(true);
      expect(store.$error.get()).toBeNull();
    });

    it('should fetch flags when appKey is provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: true }),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(store.$flags.get()).toEqual({ F1: true, F2: true });
      expect(store.$isReady.get()).toBe(true);
    });

    it('should warn if already initialized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await store.initTogglyClient({ appKey: 'test-key' });
      await store.initTogglyClient({ appKey: 'test-key-2' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already initialized')
      );
    });

    it('should handle fetch error and set error atom', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network fail'));

      await store.initTogglyClient({ appKey: 'test-key' });

      // Falls back to defaults (empty) since no flagDefaults
      expect(store.$isReady.get()).toBe(true);
      expect(store.$flags.get()).toEqual({});
    });

    it('should fall back to defaults on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      } as Response);

      await store.initTogglyClient({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      expect(store.$flags.get()).toEqual({ F1: true });
      expect(store.$isReady.get()).toBe(true);
    });

    it('should construct correct API URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await store.initTogglyClient({
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://api.toggly.io',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.toggly.io/evaluated-signed/my-key/Staging',
        expect.any(Object)
      );
    });

    it('should include identity in URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await store.initTogglyClient({
        appKey: 'my-key',
        environment: 'Production',
        identity: 'user-42',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('?u=user-42'),
        expect.any(Object)
      );
    });

    it('should register initial hooks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      let refreshCalled = false;
      await store.initTogglyClient({
        appKey: 'test-key',
        hooks: [
          {
            getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
            afterRefresh: async () => { refreshCalled = true; },
          },
        ],
      });

      expect(refreshCalled).toBe(true);
    });

    it('should log in debug mode', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));

      await store.initTogglyClient({
        appKey: '',
        flagDefaults: { F1: true },
        isDebug: true,
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Toggly Client]'),
        expect.anything()
      );
    });
  });

  // ─── refreshFlags ──────────────────────
  describe('refreshFlags', () => {
    it('should log error when not initialized', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await store.refreshFlags();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should refresh flags after initialization', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: () => Promise.resolve(
            callCount === 1 ? { F1: true } : { F1: true, F2: true }
          ),
        } as Response;
      });

      await store.initTogglyClient({ appKey: 'test-key' });
      expect(store.$flags.get()).toEqual({ F1: true });

      await store.refreshFlags();
      expect(store.$flags.get()).toEqual({ F1: true, F2: true });
    });
  });

  // ─── setIdentity ──────────────────────
  describe('setIdentity', () => {
    it('should log error when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      store.setIdentity('user-123');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should set identity and trigger refresh', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key' });
      store.setIdentity('user-123');

      // Wait for the refresh triggered by setIdentity
      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ─── clearIdentity ──────────────────────
  describe('clearIdentity', () => {
    it('should log error when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      store.clearIdentity();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should clear identity and trigger refresh', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key', identity: 'user-1' });
      store.clearIdentity();

      await vi.waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // ─── stopRefreshInterval ──────────────────────
  describe('stopRefreshInterval', () => {
    it('should not throw when not initialized', () => {
      expect(() => store.stopRefreshInterval()).not.toThrow();
    });

    it('should stop interval after initialization', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
        enableLiveUpdates: false,
      });

      const callsAfterInit = fetchSpy.mock.calls.length;
      store.stopRefreshInterval();

      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterInit);
      vi.useRealTimers();
    });
  });

  // ─── addHook / removeHook ──────────────────────
  describe('addHook', () => {
    it('should log error when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      store.addHook({
        getMetadata: () => ({ name: 'Test', version: '1.0.0' }),
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should add hook after initialization', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key' });

      // Should not throw
      store.addHook({
        getMetadata: () => ({ name: 'DynHook', version: '1.0.0' }),
      });
    });
  });

  describe('removeHook', () => {
    it('should log error and return false when not initialized', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = store.removeHook('SomeHook');
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('not initialized')
      );
    });

    it('should remove hook after initialization', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await store.initTogglyClient({ appKey: 'test-key' });
      store.addHook({
        getMetadata: () => ({ name: 'ToRemove', version: '1.0.0' }),
      });
      expect(store.removeHook('ToRemove')).toBe(true);
      expect(store.removeHook('ToRemove')).toBe(false);
    });
  });

  // ─── Refresh interval ──────────────────────
  describe('refresh interval', () => {
    it('should start refresh interval when configured', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
        enableLiveUpdates: false,
      });

      const callsAfterInit = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterInit);
      store.stopRefreshInterval();
      vi.useRealTimers();
    });

    it('should not start refresh when interval is 0', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
        enableLiveUpdates: false,
      });

      const callsAfterInit = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200000);

      expect(fetchSpy.mock.calls.length).toBe(callsAfterInit);
      vi.useRealTimers();
    });

    it('skips poll ticks while WebSocket is connected within fallback window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 5000,
      });

      latestWs().triggerOpen();
      const callsAfterOpen = fetchSpy.mock.calls.length;

      await vi.advanceTimersByTimeAsync(15000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterOpen);

      store.stopRefreshInterval();
      vi.useRealTimers();
    });
  });

  // ─── HTTP 304 and revision caching ──────────────────────
  describe('HTTP 304 and revision caching', () => {
    it('sends If-None-Match after caching revision from ETag', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }, 'rev-123'),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
        enableLiveUpdates: false,
      });

      await store.refreshFlags();

      const secondCall = fetchSpy.mock.calls[1];
      const headers = secondCall[1]?.headers as Record<string, string>;
      expect(headers['If-None-Match']).toBe('rev-123');
    });

    it('uses cached flags on 304 Not Modified', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return mockOkResponse({ F1: true }, 'rev-abc');
        }
        return {
          ok: false,
          status: 304,
          statusText: 'Not Modified',
          headers: { get: () => null },
          text: async () => '',
          json: async () => ({}),
        } as Response;
      });

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
        enableLiveUpdates: false,
      });
      expect(store.$flags.get()).toEqual({ F1: true });

      await store.refreshFlags();
      expect(store.$flags.get()).toEqual({ F1: true });
    });
  });

  // ─── WebSocket live updates ──────────────────────
  describe('WebSocket live updates', () => {
    it('does not create WebSocket when enableLiveUpdates is false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOkResponse({ F1: true }));

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
        enableLiveUpdates: false,
      });

      expect(wsInstances).toHaveLength(0);
    });

    it('creates WebSocket with sdk query params', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOkResponse({ F1: true }));

      await store.initTogglyClient({
        appKey: 'my-app-key',
        featureFlagsRefreshInterval: 0,
        baseURI: 'https://definitions.toggly.io',
      });

      expect(latestWs()).toBeDefined();
      expect(latestWs().url).toBe(
        `wss://definitions.toggly.io/my-app-key/ws?sdk=gatsby&sdkVersion=${SDK_VERSION}`,
      );
    });

    it('includes rev when a revision was cached from HTTP', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }, 'etag-1'),
      );

      await store.initTogglyClient({
        appKey: 'my-app-key',
        featureFlagsRefreshInterval: 0,
        baseURI: 'https://definitions.toggly.io',
      });

      expect(latestWs().url).toContain('rev=etag-1');
      expect(latestWs().url).toContain('sdk=gatsby');
    });

    it('triggers refresh on plain text update after debounce', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
      });

      const before = fetchSpy.mock.calls.length;
      latestWs().triggerMessage('update');
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();

      expect(fetchSpy.mock.calls.length).toBeGreaterThan(before);
      vi.useRealTimers();
    });

    it('triggers refresh on JSON flags-updated and clears revision', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockOkResponse({ F1: true }, 'old-rev'))
        .mockResolvedValue(mockOkResponse({ F1: false }, 'new-rev'));

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
      });

      latestWs().triggerMessage(JSON.stringify({ type: 'flags-updated', etag: 'new-rev' }));
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();

      const refreshCall = fetchSpy.mock.calls[1];
      const headers = refreshCall[1]?.headers as Record<string, string>;
      expect(headers['If-None-Match']).toBeUndefined();
      expect(store.$flags.get()).toEqual({ F1: false });
      vi.useRealTimers();
    });

    it('does not refresh on sync unchanged', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }, 'abc'),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
      });

      const before = fetchSpy.mock.calls.length;
      latestWs().triggerMessage(
        JSON.stringify({ type: 'sync', etag: 'abc', unchanged: true }),
      );
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();

      expect(fetchSpy.mock.calls.length).toBe(before);
      vi.useRealTimers();
    });

    it('schedules reconnect with backoff on close', async () => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOkResponse({ F1: true }));

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
      });

      expect(wsInstances).toHaveLength(1);
      latestWs().triggerClose();

      await vi.advanceTimersByTimeAsync(5000);
      expect(wsInstances.length).toBeGreaterThanOrEqual(2);
      vi.useRealTimers();
    });

    it('stopWebSocket cancels pending debounced refresh', async () => {
      vi.useFakeTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockOkResponse({ F1: true }),
      );

      await store.initTogglyClient({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 0,
      });

      const before = fetchSpy.mock.calls.length;
      latestWs().triggerMessage('update');
      store.stopWebSocket();
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();

      expect(fetchSpy.mock.calls.length).toBe(before);
      vi.useRealTimers();
    });
  });

  // ─── fetchFlags error handling ──────────────────────
  describe('fetchFlags error handling', () => {
    it('should use cached flags on error after successful fetch', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return mockOkResponse({ F1: true });
        }
        throw new Error('Network fail');
      });

      await store.initTogglyClient({
        appKey: 'test-key',
        isDebug: true,
        enableLiveUpdates: false,
        featureFlagsRefreshInterval: 0,
      });
      expect(store.$flags.get()).toEqual({ F1: true });

      // Refresh should fall back to cached flags
      await store.refreshFlags();
      expect(store.$flags.get()).toEqual({ F1: true });
    });

    it('should handle refresh error gracefully', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return mockOkResponse({ F1: true });
        }
        throw new Error('Refresh failed');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await store.initTogglyClient({
        appKey: 'test-key',
        enableLiveUpdates: false,
        featureFlagsRefreshInterval: 0,
      });
      await store.refreshFlags();

      // Should not crash
      expect(store.$isReady.get()).toBe(true);
    });
  });
});
