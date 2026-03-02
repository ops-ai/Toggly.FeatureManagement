import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TogglyServer, createTogglyServerClient } from '../../server/toggly-server.js';

describe('TogglyServer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constructor ──────────────────────
  describe('constructor', () => {
    it('should use default config values', async () => {
      const server = new TogglyServer({ appKey: '' });
      const flags = await server.getFlags();
      expect(flags).toEqual({});
    });

    it('should accept flagDefaults', async () => {
      const server = new TogglyServer({
        appKey: '',
        flagDefaults: { F1: true, F2: false },
      });
      const flags = await server.getFlags();
      expect(flags).toEqual({ F1: true, F2: false });
    });
  });

  // ─── getFlags ──────────────────────
  describe('getFlags', () => {
    it('should return flagDefaults when no appKey', async () => {
      const server = new TogglyServer({
        appKey: '',
        flagDefaults: { F1: true },
      });
      const flags = await server.getFlags();
      expect(flags).toEqual({ F1: true });
    });

    it('should fetch flags when appKey provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: true }),
      } as Response);

      const server = new TogglyServer({
        appKey: 'test-key',
        environment: 'Production',
      });
      const flags = await server.getFlags();
      expect(flags).toEqual({ F1: true, F2: true });
    });

    it('should use cache for subsequent calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 300000, // 5 minutes
      });

      await server.getFlags();
      await server.getFlags();

      // Should only fetch once due to caching
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache when expired', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 100, // 100ms
      });

      await server.getFlags();
      // Wait for cache to expire
      await new Promise((r) => setTimeout(r, 150));
      await server.getFlags();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should fall back to flagDefaults on fetch error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const server = new TogglyServer({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ F1: true });
    });

    it('should fall back to cached flags on error', async () => {
      let callCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: () => Promise.resolve({ F1: true, F2: true }),
          } as Response;
        }
        throw new Error('Network error');
      });

      const server = new TogglyServer({
        appKey: 'test-key',
        featureFlagsRefreshInterval: 100,
      });

      const flags1 = await server.getFlags();
      expect(flags1).toEqual({ F1: true, F2: true });

      // Wait for cache to expire
      await new Promise((r) => setTimeout(r, 150));
      const flags2 = await server.getFlags();
      // Falls back to cached flags (from first successful fetch)
      expect(flags2).toEqual({ F1: true, F2: true });
    });

    it('should handle non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      const server = new TogglyServer({
        appKey: 'test-key',
        flagDefaults: { F1: true },
      });

      const flags = await server.getFlags();
      expect(flags).toEqual({ F1: true });
    });

    it('should construct correct API URL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const server = new TogglyServer({
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://api.toggly.io/',
      });

      await server.getFlags();
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

      const server = new TogglyServer({
        appKey: 'my-key',
        identity: 'user-42',
      });

      await server.getFlags();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('?u=user-42'),
        expect.any(Object)
      );
    });
  });

  // ─── getFlag ──────────────────────
  describe('getFlag', () => {
    it('should return true for enabled flag', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.getFlag('F1');
      expect(result).toBe(true);
    });

    it('should return false for disabled flag', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: false }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.getFlag('F1');
      expect(result).toBe(false);
    });

    it('should return default value for missing flag', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.getFlag('F2', true);
      expect(result).toBe(true);
    });

    it('should check flagDefaults before defaultValue', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({
        appKey: 'test-key',
        flagDefaults: { F2: true },
      });

      const result = await server.getFlag('F2', false);
      expect(result).toBe(true);
    });

    it('should use false as default when not specified', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.getFlag('Unknown');
      expect(result).toBe(false);
    });
  });

  // ─── evaluateGate ──────────────────────
  describe('evaluateGate', () => {
    it('should evaluate "all" requirement - all true', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: true }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate(['F1', 'F2'], 'all');
      expect(result).toBe(true);
    });

    it('should evaluate "all" requirement - one false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate(['F1', 'F2'], 'all');
      expect(result).toBe(false);
    });

    it('should evaluate "any" requirement', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate(['F1', 'F2'], 'any');
      expect(result).toBe(true);
    });

    it('should evaluate "any" requirement - all false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: false, F2: false }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate(['F1', 'F2'], 'any');
      expect(result).toBe(false);
    });

    it('should support negate', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate(['F1'], 'all', true);
      expect(result).toBe(false);
    });

    it('should return true for empty keys without negate', async () => {
      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate([], 'all');
      expect(result).toBe(true);
    });

    it('should return false for empty keys with negate', async () => {
      const server = new TogglyServer({ appKey: 'test-key' });
      const result = await server.evaluateGate([], 'all', true);
      expect(result).toBe(false);
    });
  });

  // ─── refreshFlags ──────────────────────
  describe('refreshFlags', () => {
    it('should fetch and cache flags', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({ appKey: 'test-key' });
      await server.refreshFlags();

      const flags = await server.getFlags();
      expect(flags).toEqual({ F1: true });
      // getFlags should use cache, so only one fetch call from refreshFlags
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should prevent concurrent fetches', async () => {
      let resolvePromise: (value: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchPromise);

      const server = new TogglyServer({ appKey: 'test-key' });

      // Start two concurrent refreshes
      const refresh1 = server.refreshFlags();
      const refresh2 = server.refreshFlags();

      // Resolve the fetch
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      await refresh1;
      await refresh2;

      // Should only fetch once
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should log in debug mode', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer({
        appKey: 'test-key',
        isDebug: true,
      });
      await server.refreshFlags();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Refreshing flags')
      );
    });
  });

  // ─── allFeaturesEnabledDuringBuild ──────────────────────
  describe('allFeaturesEnabledDuringBuild', () => {
    it('should enable all features during build', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          allFeaturesEnabledDuringBuild: true,
          flagDefaults: { F3: false },
        },
        true // isBuildTime
      );

      const flags = await server.getFlags();
      expect(flags.F1).toBe(true);
      expect(flags.F2).toBe(true);
      expect(flags.F3).toBe(true);
    });

    it('should not override when not build time', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          allFeaturesEnabledDuringBuild: true,
        },
        false // not build time
      );

      const flags = await server.getFlags();
      expect(flags.F2).toBe(false);
    });

    it('should not override when allFeaturesEnabledDuringBuild is false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true, F2: false }),
      } as Response);

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          allFeaturesEnabledDuringBuild: false,
        },
        true
      );

      const flags = await server.getFlags();
      expect(flags.F2).toBe(false);
    });

    it('should log in debug mode during build override', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: true }),
      } as Response);

      const server = new TogglyServer(
        {
          appKey: 'test-key',
          allFeaturesEnabledDuringBuild: true,
          isDebug: true,
        },
        true
      );

      await server.getFlags();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Build mode: Enabling all features')
      );
    });
  });

  // ─── createTogglyServerClient ──────────────────────
  describe('createTogglyServerClient', () => {
    it('should create a TogglyServer instance', () => {
      const client = createTogglyServerClient({ appKey: 'test-key' });
      expect(client).toBeInstanceOf(TogglyServer);
    });

    it('should pass isBuildTime parameter', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ F1: false }),
      } as Response);

      const client = createTogglyServerClient(
        { appKey: 'test-key', allFeaturesEnabledDuringBuild: true },
        true
      );

      const flags = await client.getFlags();
      expect(flags.F1).toBe(true);
    });
  });
});
