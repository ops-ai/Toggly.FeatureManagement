import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TogglyServer, createTogglyServerClient } from '../../server/toggly-server.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(flags: Record<string, boolean>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(flags),
  };
}

describe('TogglyServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should apply default config values', () => {
      const server = new TogglyServer({});
      // Verify defaults by testing behavior (no direct access to private config)
      // Without appKey, getFlags should return flagDefaults
      expect(server.getFlags()).resolves.toEqual({});
    });

    it('should merge provided config with defaults', async () => {
      const server = new TogglyServer({
        flagDefaults: { Feature1: true },
      });
      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: true });
    });

    it('should accept isBuildTime parameter', () => {
      const server = new TogglyServer({ allFeaturesEnabledDuringBuild: true }, true);
      // No error thrown
      expect(server).toBeInstanceOf(TogglyServer);
    });
  });

  describe('getFlags', () => {
    it('should return flagDefaults when no appKey is configured', async () => {
      const server = new TogglyServer({
        flagDefaults: { Feature1: true, Feature2: false },
      });
      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: true, Feature2: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty object when no appKey and no flagDefaults', async () => {
      const server = new TogglyServer({});
      const flags = await server.getFlags();
      expect(flags).toEqual({});
    });

    it('should fetch flags from API when appKey is set', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true, Feature2: false })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: true, Feature2: false });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should construct the correct API URL', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://client.toggly.io',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://client.toggly.io/evaluated-signed/my-key/Staging',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should include identity as query parameter', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
        identity: 'user-123',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-signed/my-key/Production?u=user-123',
        expect.anything()
      );
    });

    it('should URL-encode identity', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
        identity: 'user name@test.com',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('?u=user%20name%40test.com'),
        expect.anything()
      );
    });

    it('should strip trailing slash from baseURI', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
        baseURI: 'https://client.toggly.io/',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://client.toggly.io/evaluated-signed/my-key/Production',
        expect.anything()
      );
    });

    it('should use cache: no-store on fetch', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cache: 'no-store' })
      );
    });

    it('should pass AbortController signal for timeout', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
        connectTimeout: 3000,
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('caching', () => {
    it('should cache flags after first fetch', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 180000,
      });

      await server.getFlags();
      const flags2 = await server.getFlags();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(flags2).toEqual({ Feature1: true });
    });

    it('should refetch when cache expires', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ Feature1: true }))
        .mockResolvedValueOnce(createMockResponse({ Feature1: false }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 1000,
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance time past cache expiry
      vi.advanceTimersByTime(1500);

      const flags2 = await server.getFlags();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(flags2).toEqual({ Feature1: false });
    });

    it('should return cached flags when within cache interval', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 180000,
      });

      await server.getFlags();

      // Advance only 1 second (well within 3-minute cache)
      vi.advanceTimersByTime(1000);

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('should return flagDefaults on fetch error when no cache', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        flagDefaults: { Feature1: true },
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: true });
    });

    it('should return cached flags on fetch error when cache exists', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ Feature1: true, Feature2: true }))
        .mockRejectedValueOnce(new Error('Network error'));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 1000,
      });

      // First fetch succeeds
      await server.getFlags();

      // Expire cache
      vi.advanceTimersByTime(1500);

      // Second fetch fails - should use cached flags
      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: true, Feature2: true });
    });

    it('should throw-safe on non-ok response status', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 500));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        flagDefaults: { Fallback: true },
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ Fallback: true });
    });

    it('should return flagDefaults on 404', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, 404));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        flagDefaults: { Default: true },
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ Default: true });
    });
  });

  describe('refreshFlags', () => {
    it('should force refresh and update cache', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ Feature1: true }))
        .mockResolvedValueOnce(createMockResponse({ Feature1: false }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        featureFlagsRefreshInterval: 180000,
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await server.refreshFlags();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: false });
    });

    it('should deduplicate concurrent refresh calls', async () => {
      let resolvePromise: (value: any) => void;
      const delayedFetch = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValueOnce(
        delayedFetch.then(() => createMockResponse({ Feature1: true }))
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      // Start two concurrent refreshes
      const p1 = server.refreshFlags();
      const p2 = server.refreshFlags();

      // Resolve the delayed fetch
      resolvePromise!(undefined);
      await Promise.all([p1, p2]);

      // Should only have fetched once
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('getFlag', () => {
    it('should return flag value when it exists', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true, Feature2: false })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.getFlag('Feature1')).toBe(true);
      expect(await server.getFlag('Feature2')).toBe(false);
    });

    it('should return defaultValue when flag not found', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ Feature1: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.getFlag('Unknown', true)).toBe(true);
      expect(await server.getFlag('Unknown', false)).toBe(false);
    });

    it('should return false as default when no defaultValue provided', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ Feature1: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.getFlag('Unknown')).toBe(false);
    });

    it('should check flagDefaults before using provided defaultValue', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        flagDefaults: { MyDefault: true },
      });

      // MyDefault exists in flagDefaults
      expect(await server.getFlag('MyDefault', false)).toBe(true);
    });
  });

  describe('evaluateGate', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue(
        createMockResponse({ F1: true, F2: true, F3: false })
      );
    });

    it('should return true when empty keys and not negated', async () => {
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });
      expect(await server.evaluateGate([])).toBe(true);
    });

    it('should return false when empty keys and negated', async () => {
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });
      expect(await server.evaluateGate([], 'all', true)).toBe(false);
    });

    it('should evaluate "all" requirement correctly', async () => {
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.evaluateGate(['F1', 'F2'], 'all')).toBe(true);
      expect(await server.evaluateGate(['F1', 'F3'], 'all')).toBe(false);
    });

    it('should evaluate "any" requirement correctly', async () => {
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.evaluateGate(['F1', 'F3'], 'any')).toBe(true);
      expect(await server.evaluateGate(['F3'], 'any')).toBe(false);
    });

    it('should negate the result when negate is true', async () => {
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.evaluateGate(['F1', 'F2'], 'all', true)).toBe(false);
      expect(await server.evaluateGate(['F3'], 'all', true)).toBe(true);
    });

    it('should default to "all" requirement', async () => {
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      // Default should be 'all'
      expect(await server.evaluateGate(['F1', 'F2'])).toBe(true);
      expect(await server.evaluateGate(['F1', 'F3'])).toBe(false);
    });
  });

  describe('allFeaturesEnabledDuringBuild', () => {
    it('should override all flags to true during build when enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true, Feature2: false, Feature3: false })
      );

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          environment: 'Production',
          allFeaturesEnabledDuringBuild: true,
        },
        true // isBuildTime
      );

      const flags = await server.getFlags();
      expect(flags.Feature1).toBe(true);
      expect(flags.Feature2).toBe(true);
      expect(flags.Feature3).toBe(true);
    });

    it('should NOT override flags when not in build time', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true, Feature2: false })
      );

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          environment: 'Production',
          allFeaturesEnabledDuringBuild: true,
        },
        false // NOT build time
      );

      const flags = await server.getFlags();
      expect(flags.Feature1).toBe(true);
      expect(flags.Feature2).toBe(false);
    });

    it('should NOT override flags when allFeaturesEnabledDuringBuild is false', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ Feature1: true, Feature2: false })
      );

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          environment: 'Production',
          allFeaturesEnabledDuringBuild: false,
        },
        true // is build time, but option disabled
      );

      const flags = await server.getFlags();
      expect(flags.Feature2).toBe(false);
    });
  });

  describe('debug logging', () => {
    it('should log when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        isDebug: true,
      });

      await server.getFlags();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Toggly Server]'),
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it('should not log when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(createMockResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        isDebug: false,
      });

      await server.getFlags();
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('createTogglyServerClient', () => {
    it('should create a TogglyServer instance', () => {
      const client = createTogglyServerClient({ environment: 'Test' });
      expect(client).toBeInstanceOf(TogglyServer);
    });

    it('should pass isBuildTime to the instance', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ F1: false })
      );

      const client = createTogglyServerClient(
        {
          appKey: 'test-key',
          environment: 'Production',
          allFeaturesEnabledDuringBuild: true,
        },
        true
      );

      const flags = await client.getFlags();
      expect(flags.F1).toBe(true); // Should be overridden because build time
    });
  });
});
