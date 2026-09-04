import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TogglyServer, createTogglyServerClient } from '../../server/toggly-server.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockResponse(body: unknown, status = 200) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function featureDefs(flags: Record<string, boolean>) {
  return Object.entries(flags).map(([featureKey, enabled]) => ({
    featureKey,
    filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }],
  }));
}

function createDefsResponse(flags: Record<string, boolean>, status = 200) {
  return createMockResponse(featureDefs(flags), status);
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
    it('should apply default config values', async () => {
      const server = new TogglyServer({});
      // Verify defaults by testing behavior (no direct access to private config)
      // Without appKey, getFlags should return flagDefaults
      await expect(server.getFlags()).resolves.toEqual({});
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
        createDefsResponse({ Feature1: true, Feature2: false })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ Feature1: true, Feature2: false });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('reads text() and rejects invalid envelope when verifySignatures is true', async () => {
      const invalidBody = JSON.stringify({ defs: { Feature1: true } });
      const text = vi.fn().mockResolvedValue(invalidBody);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text,
        json: () => Promise.resolve(JSON.parse(invalidBody)),
      });

      const server = new TogglyServer({
        appKey: 'test-key',
        verifySignatures: true,
        flagDefaults: { Feature1: false },
      });

      // Invalid envelope throws inside fetchFlags; server falls back to defaults
      const flags = await server.getFlags();
      expect(text).toHaveBeenCalled();
      expect(flags).toEqual({ Feature1: false });
    });

    it('should construct the correct API URL', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://client.toggly.io',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://client.toggly.io/definitions-signed/my-key/Staging',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should not include identity/groups/claims on definitions-signed URL', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
        identity: 'user-123',
        groups: ['beta'],
        claims: { role: 'admin' },
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/definitions-signed/my-key/Production',
        expect.anything()
      );
    });

    it('should strip trailing slash from baseURI', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Production',
        baseURI: 'https://client.toggly.io/',
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://client.toggly.io/definitions-signed/my-key/Production',
        expect.anything()
      );
    });

    it('should use cache: no-store on fetch', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

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
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

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
        createDefsResponse({ Feature1: true })
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
        .mockResolvedValueOnce(createDefsResponse({ Feature1: true }))
        .mockResolvedValueOnce(createDefsResponse({ Feature1: false }));

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
        createDefsResponse({ Feature1: true })
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
        .mockResolvedValueOnce(createDefsResponse({ Feature1: true, Feature2: true }))
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
        .mockResolvedValueOnce(createDefsResponse({ Feature1: true }))
        .mockResolvedValueOnce(createDefsResponse({ Feature1: false }));

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
        delayedFetch.then(() => createDefsResponse({ Feature1: true }))
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
        createDefsResponse({ Feature1: true, Feature2: false })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.getFlag('Feature1')).toBe(true);
      expect(await server.getFlag('Feature2')).toBe(false);
    });

    it('evaluates UserClaims filters using config claims', async () => {
      const claimsDef = [
        {
          featureKey: 'ClaimsFlag',
          filters: [
            {
              name: 'UserClaims',
              parameters: { Percentage: 100, Claim: 'role', Value: 'admin' },
            },
          ],
        },
      ];

      mockFetch.mockResolvedValueOnce(createMockResponse(claimsDef));
      const denied = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-1',
        claims: { role: 'user' },
      });
      expect(await denied.getFlag('ClaimsFlag')).toBe(false);

      mockFetch.mockResolvedValueOnce(createMockResponse(claimsDef));
      const allowed = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-1',
        claims: { role: 'admin' },
      });
      expect(await allowed.getFlag('ClaimsFlag')).toBe(true);
    });

    it('should return defaultValue when flag not found', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ Feature1: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.getFlag('Unknown', true)).toBe(true);
      expect(await server.getFlag('Unknown', false)).toBe(false);
    });

    it('should return false as default when no defaultValue provided', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ Feature1: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });

      expect(await server.getFlag('Unknown')).toBe(false);
    });

    it('should check flagDefaults before using provided defaultValue', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({}));

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
        createDefsResponse({ F1: true, F2: true, F3: false })
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

    it('should evaluate boolean cache path when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          defs: {
            F1: { enabled: true, variant: 'A' },
            F2: { enabled: false, variant: 'control' },
          },
        }),
      );
      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
      });

      expect(await server.evaluateGate(['F1', 'F2'], 'any')).toBe(true);
      expect(await server.evaluateGate(['F1', 'F2'], 'all')).toBe(false);
      expect(await server.evaluateGate(['F2'], 'all', true)).toBe(true);
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
        createDefsResponse({ Feature1: true, Feature2: false, Feature3: false })
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
        createDefsResponse({ Feature1: true, Feature2: false })
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
        createDefsResponse({ Feature1: true, Feature2: false })
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
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

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
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F1: true }));

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

  describe('enableVariants', () => {
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

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/test-key/Production',
        expect.anything()
      );

      expect(await server.getVariant('V')).toEqual({
        name: 'A',
        configurationValue: { x: 1 },
      });
      expect(await server.getVariantValue('V')).toEqual({ x: 1 });
      expect(await server.getFlag('V')).toBe(true);
    });

    it('should pass userId query when enableVariants and identity are set', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          defs: { F: { enabled: false, variant: 'control' } },
        })
      );

      const server = new TogglyServer({
        appKey: 'k',
        environment: 'Staging',
        identity: 'user@x.com',
        enableVariants: true,
      });

      await server.getFlags();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/k/Staging?userId=user%40x.com',
        expect.anything()
      );
    });

    it('getVariant returns null when enableVariants is false', async () => {
      mockFetch.mockResolvedValueOnce(createDefsResponse({ F: true }));

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: false,
      });

      await server.getFlags();
      expect(await server.getVariant('F')).toBeNull();
      expect(await server.getVariantValue('F')).toBeNull();
    });

    it('getVariant returns null when enabled but no variant name on def', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          defs: { V: { enabled: true, configurationValue: 'x' } },
        })
      );

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
      });

      await server.getFlags();
      expect(await server.getVariant('V')).toBeNull();
      expect(await server.getVariantValue('V')).toBeNull();
    });
  });

  describe('createTogglyServerClient', () => {
    it('should create a TogglyServer instance', () => {
      const client = createTogglyServerClient({ environment: 'Test' });
      expect(client).toBeInstanceOf(TogglyServer);
    });

    it('should pass isBuildTime to the instance', async () => {
      mockFetch.mockResolvedValueOnce(
        createDefsResponse({ F1: false })
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
