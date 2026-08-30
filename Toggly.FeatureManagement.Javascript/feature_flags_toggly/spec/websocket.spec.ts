import { Toggly } from '../lib/toggly';

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-ws'),
}));

// Mock fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: any) => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  url: string;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helpers
  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  triggerMessage(data: any) {
    if (this.onmessage) this.onmessage({ data });
  }

  triggerClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  triggerError(error: any) {
    if (this.onerror) this.onerror(error);
  }
}

let instances: MockWebSocket[] = [];

function latestWs(): MockWebSocket {
  return instances[instances.length - 1];
}

// Replace global WebSocket with mock
(global as any).WebSocket = MockWebSocket;

const mockInitResponse = {
  ok: true,
  json: async () => ({ feature_flags: { FlagOn: true } }),
  headers: { get: () => null },
};

describe('Toggly WebSocket', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localStorage.clear();
    instances = [];
    Toggly.cancelRefreshInterval();
    mockFetch.mockReset();
  });

  afterEach(() => {
    Toggly.cancelRefreshInterval();
    jest.useRealTimers();
  });

  describe('startWebSocket — skip conditions', () => {
    it('does not create WebSocket when enableLiveUpdates is false', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        enableLiveUpdates: false,
        featureFlagsRefreshInterval: 0,
      });

      expect(instances).toHaveLength(0);
    });

    it('does not create WebSocket when no appKey', async () => {
      await Toggly.init({ flagDefaults: { F1: true } });

      expect(instances).toHaveLength(0);
    });
  });

  describe('startWebSocket — connection', () => {
    it('creates WebSocket with correct URL', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'my-app-key',
        environment: 'Test',
        baseURI: 'https://definitions.toggly.io',
        featureFlagsRefreshInterval: 0,
      });

      expect(latestWs()).toBeDefined();
      expect(latestWs().url).toBe('wss://definitions.toggly.io/my-app-key/ws?sdk=javascript&sdkVersion=1.3.1');
    });

    it('sets wsConnected to true on open', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 0,
      });

      latestWs().triggerOpen();

      expect(Toggly._wsConnected).toBe(true);
    });
  });

  describe('WebSocket message handling', () => {
    async function initWithWs() {
      mockFetch.mockResolvedValue(mockInitResponse);
      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 0,
      });
      mockFetch.mockResolvedValue(mockInitResponse);
    }

    it('triggers refresh on plain text "update" message', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage('update');
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    });

    it('triggers refresh on plain text "flags-updated" message', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage('flags-updated');
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    });

    it('triggers refresh on JSON flags-updated message', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage(JSON.stringify({ type: 'flags-updated' }));
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    });

    it('triggers refresh on JSON update message', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage(JSON.stringify({ type: 'update' }));
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    });

    it('does not refresh on sync unchanged message', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage(JSON.stringify({
        type: 'sync',
        etag: 'abc123',
        lastUpdated: Date.now(),
        unchanged: true,
      }));
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBe(before);
    });

    it('triggers refresh on sync when no cached revision exists', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage(JSON.stringify({
        type: 'sync',
        etag: 'abc123',
        lastUpdated: Date.now(),
      }));
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    });

    it('ignores JSON ping message without refresh', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage(JSON.stringify({ type: 'ping' }));
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBe(before);
    });

    it('ignores unrecognized JSON message without throwing', async () => {
      await initWithWs();

      expect(() =>
        latestWs().triggerMessage(JSON.stringify({ type: 'unknown' }))
      ).not.toThrow();
    });

    it('handles invalid JSON gracefully without throwing', async () => {
      await initWithWs();

      expect(() =>
        latestWs().triggerMessage('not-valid-{json')
      ).not.toThrow();
    });

    it('triggers force refresh on signing-key-updated when verifySignatures is enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ F1: true }),
        headers: { get: () => 'rev-1' },
      });

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        verifySignatures: true,
        featureFlagsRefreshInterval: 0,
      });

      const before = mockFetch.mock.calls.length;
      latestWs().triggerMessage(JSON.stringify({ type: 'signing-key-updated' }));
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
    });

    it('caches etag from sync message without refresh when unchanged', async () => {
      const { StorageKeys } = require('../lib/models');
      localStorage.setItem(
        StorageKeys.definitionsRevisionCacheKey('test-key', 'Test'),
        'abc123',
      );

      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage(JSON.stringify({
        type: 'sync',
        etag: 'abc123',
        unchanged: true,
      }));
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBe(before);
    });

    it('cancels pending debounced refresh on stopWebSocket', async () => {
      await initWithWs();
      const before = mockFetch.mock.calls.length;

      latestWs().triggerMessage('update');
      Toggly.stopWebSocket();
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(mockFetch.mock.calls.length).toBe(before);
    });

    it('does not cache WS etag before HTTP confirms', async () => {
      const { StorageKeys } = require('../lib/models');
      const revisionKey = StorageKeys.definitionsRevisionCacheKey('test-key', 'Test');
      localStorage.setItem(revisionKey, 'old-rev');

      await initWithWs();

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ FlagOn: true }),
        text: async () => JSON.stringify({ FlagOn: true }),
        headers: {
          get: (name: string) =>
            name === 'X-Definitions-Revision' || name === 'ETag' ? 'rev-from-http' : null,
        },
      });

      latestWs().triggerMessage(JSON.stringify({
        type: 'flags-updated',
        etag: 'rev-from-ws',
      }));

      expect(Toggly._pendingDefinitionsPin).toBe('rev-from-ws');
      expect(localStorage.getItem(revisionKey)).not.toBe('rev-from-ws');

      jest.advanceTimersByTime(300);
      // Flush fetch → applyFetchRevision → body parse chain
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(String(lastCall[0])).toContain('rev=rev-from-ws');
      const headers = (lastCall[1]?.headers ?? {}) as Record<string, string>;
      expect(headers['If-None-Match'] ?? headers['if-none-match']).toBeUndefined();

      expect(localStorage.getItem(revisionKey)).toBe('rev-from-http');
      expect(Toggly._pendingDefinitionsPin).toBeNull();
    });

    it('resets debounce timer when multiple updates arrive quickly', async () => {
      await initWithWs();
      latestWs().triggerMessage('update');
      latestWs().triggerMessage('update');
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('WebSocket close and reconnect', () => {
    it('sets wsConnected to false on close', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 0,
      });

      latestWs().triggerOpen();
      expect(Toggly._wsConnected).toBe(true);

      latestWs().triggerClose();
      expect(Toggly._wsConnected).toBe(false);
    });

    it('schedules reconnect after close', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 0,
      });

      const countBefore = instances.length;
      latestWs().triggerClose();

      jest.advanceTimersByTime(5100);

      expect(instances.length).toBeGreaterThan(countBefore);
    });
  });

  describe('WebSocket error', () => {
    it('logs error without throwing', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 0,
      });

      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => latestWs().triggerError(new Error('ws error'))).not.toThrow();
      spy.mockRestore();
    });
  });

  describe('stopWebSocket with reconnect timer', () => {
    it('cancels pending reconnect timer on stop', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 0,
      });

      const countAfterInit = instances.length;
      latestWs().triggerClose(); // schedules reconnect in 5s

      Toggly.stopWebSocket(); // should cancel the timer

      jest.advanceTimersByTime(5100); // timer fires, but should be cancelled

      expect(instances.length).toBe(countAfterInit); // no new WebSocket created
    });
  });

  describe('startRefreshInterval with WebSocket active', () => {
    it('skips interval refresh when WebSocket is connected and recently active', async () => {
      mockFetch.mockResolvedValue(mockInitResponse);

      await Toggly.init({
        appKey: 'test-key',
        environment: 'Test',
        featureFlagsRefreshInterval: 1000,
      });

      // Simulate WebSocket connecting and setting lastFallbackRefresh
      latestWs().triggerOpen();

      const countAfterOpen = mockFetch.mock.calls.length;

      // Advance past one interval — should be skipped because WS is connected
      jest.advanceTimersByTime(1500);

      expect(mockFetch.mock.calls.length).toBe(countAfterOpen);
    });
  });
});
