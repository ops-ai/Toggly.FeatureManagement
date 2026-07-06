import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toggly } from '../plugins/toggly.service';
import type { Hook } from '@ops-ai/toggly-hooks-types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SDK_FETCH_OPTIONS = expect.objectContaining({
  headers: expect.objectContaining({
    'X-Toggly-Sdk': 'vue',
    'X-Toggly-Sdk-Version': '1.4.1',
  }),
});

describe('Toggly Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Init ─────────────────────────────────────
  describe('init', () => {
    it('should use featureDefaults when no appKey', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using feature defaults')
      );
    });

    it('should warn when no appKey and no featureDefaults', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('valid application key is required')
      );
    });

    it('should default environment to Production when appKey set', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({ appKey: 'key' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using Production environment')
      );
    });

    it('should accept appKey and environment without production warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Staging' });

      const envWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('Production environment')
      );
      expect(envWarns).toHaveLength(0);
    });

    it('should set shouldShowFeatureDuringEvaluation', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true }, showFeatureDuringEvaluation: true });
      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });

    it('should default shouldShowFeatureDuringEvaluation to false', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });

    it('should return this for chaining', () => {
      const service = new Toggly();
      const result = service.init({ featureDefaults: { F1: true } });
      expect(result).toBe(service);
    });

    it('should register hooks from config', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'InitHook', version: '1.0.0' }),
          beforeEvaluation: async (key) => { calls.push(key); },
        }],
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });
  });

  // ─── Feature Loading ──────────────────────────
  describe('_loadFeatures', () => {
    it('should return defaults when no appKey', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      const features = await service._loadFeatures();
      expect(features).toEqual({ F1: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch from API when appKey set', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ ApiFlag: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const features = await service._loadFeatures();
      expect(features).toEqual({ ApiFlag: true });
      expect(mockFetch).toHaveBeenCalledWith('https://definitions.toggly.io/evaluated-signed/key/Production', SDK_FETCH_OPTIONS);
    });

    it('should include identity in API URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production', identity: 'user-1' });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-signed/key/Production?u=user-1',
        SDK_FETCH_OPTIONS,
      );
    });

    it('should use custom baseURI', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({ baseURI: 'https://custom.api', appKey: 'key', environment: 'Staging' });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith('https://custom.api/evaluated-signed/key/Staging', SDK_FETCH_OPTIONS);
    });

    it('should fall back to featureDefaults on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production', featureDefaults: { Fallback: true } });

      const features = await service._loadFeatures();
      expect(features).toEqual({ Fallback: true });
    });

    it('should fall back to empty object when no defaults', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const features = await service._loadFeatures();
      expect(features).toEqual({});
    });

    it('should not duplicate API calls during loading', async () => {
      let resolveFirst: (v: any) => void;
      const slowPromise = new Promise((r) => { resolveFirst = r; });

      mockFetch.mockReturnValueOnce(
        slowPromise.then(() => ({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) }))
      );

      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const load1 = service._loadFeatures();
      const load2 = service._loadFeatures();
      resolveFirst!(undefined);

      const [r1, r2] = await Promise.all([load1, load2]);
      expect(r1).toEqual({ F1: true });
      expect(r2).toEqual({ F1: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cache features after first load', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      await service._loadFeatures();
      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should trigger afterRefresh hooks', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      let refreshed: any = null;
      const service = new Toggly();
      service.init({
        appKey: 'key', environment: 'Production',
        hooks: [{
          getMetadata: () => ({ name: 'RefHook', version: '1.0.0' }),
          afterRefresh: async (flags) => { refreshed = flags; },
        }],
      });

      await service._loadFeatures();
      expect(refreshed).toEqual({ F1: true });
    });
  });

  // ─── _featuresLoaded ──────────────────────────
  describe('_featuresLoaded', () => {
    it('should return features if already loaded', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      const features = await service._featuresLoaded();
      expect(features).toEqual({ F1: true });
    });

    it('should load features if not yet loaded', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ ApiFlag: true }) });
      const service = new Toggly();
      service.init({ appKey: 'key', environment: 'Production' });

      const features = await service._featuresLoaded();
      expect(features).toEqual({ ApiFlag: true });
    });
  });

  // ─── _evaluateFeatureGate ─────────────────────
  describe('_evaluateFeatureGate', () => {
    let service: Toggly;

    beforeEach(() => {
      service = new Toggly();
      service.init({ featureDefaults: { F1: true, F2: false, F3: true } });
    });

    it('should return true when all flags enabled (requirement: all)', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F3'], 'all', false)).toBe(true);
    });

    it('should return falsy when some disabled (requirement: all)', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F2'], 'all', false)).toBeFalsy();
    });

    it('should return true when any enabled (requirement: any)', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F2'], 'any', false)).toBe(true);
    });

    it('should return falsy when none enabled (requirement: any)', async () => {
      expect(await service._evaluateFeatureGate(['F2'], 'any', false)).toBeFalsy();
    });

    it('should negate result', async () => {
      expect(await service._evaluateFeatureGate(['F1'], 'all', true)).toBe(false);
    });

    it('should fail closed for empty features with non-empty gate', async () => {
      const empty = new Toggly();
      empty.init({ featureDefaults: {} });
      expect(await empty._evaluateFeatureGate(['F1'], 'all', false)).toBe(false);
    });

    it('should default requirement to all', async () => {
      expect(await service._evaluateFeatureGate(['F1', 'F3'])).toBe(true);
    });
  });

  // ─── evaluateFeatureGate (public) ─────────────
  describe('evaluateFeatureGate', () => {
    it('should call hooks for non-empty gate', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'GH', version: '1.0.0' }),
          beforeEvaluation: async (key) => { calls.push(`before:${key}`); },
          afterEvaluation: async (key) => { calls.push(`after:${key}`); },
        }],
      });

      await service.evaluateFeatureGate(['F1'], 'all', false);
      expect(calls).toEqual(['before:F1', 'after:F1']);
    });

    it('should skip hooks for empty gate', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'EH', version: '1.0.0' }),
          beforeEvaluation: async () => { calls.push('called'); },
        }],
      });

      await service.evaluateFeatureGate([], 'all', false);
      expect(calls).toHaveLength(0);
    });
  });

  // ─── isFeatureOn / isFeatureOff ───────────────
  describe('isFeatureOn', () => {
    it('should return true for enabled feature', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: false } });
      expect(await service.isFeatureOn('F1')).toBe(false);
    });

    it('should trigger hooks', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({
        featureDefaults: { F1: true },
        hooks: [{
          getMetadata: () => ({ name: 'OnH', version: '1.0.0' }),
          beforeEvaluation: async (k) => { calls.push(k); },
        }],
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });
  });

  describe('isFeatureOff', () => {
    it('should return truthy for disabled feature (negated)', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: false } });
      expect(await service.isFeatureOff('F1')).toBeTruthy();
    });

    it('should return false for enabled feature (negated)', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(await service.isFeatureOff('F1')).toBe(false);
    });
  });

  // ─── Hook Management ──────────────────────────
  describe('Hook Management', () => {
    it('should add hook dynamically', async () => {
      const calls: string[] = [];
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      service.addHook({
        getMetadata: () => ({ name: 'Dyn', version: '1.0.0' }),
        beforeEvaluation: async (k) => { calls.push(k); },
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should remove hook and return true', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      service.addHook({ getMetadata: () => ({ name: 'Rem', version: '1.0.0' }) });
      expect(service.removeHook('Rem')).toBe(true);
    });

    it('should return false for non-existent hook', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true } });
      expect(service.removeHook('Nope')).toBe(false);
    });
  });

  // ─── Edge Cases ───────────────────────────────
  describe('Edge Cases', () => {
    it('should handle concurrent evaluations', async () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F1: true, F2: false } });

      const [on1, on2, off1, off2] = await Promise.all([
        service.isFeatureOn('F1'),
        service.isFeatureOn('F2'),
        service.isFeatureOff('F1'),
        service.isFeatureOff('F2'),
      ]);

      expect(on1).toBe(true);
      expect(on2).toBe(false);
      expect(off1).toBe(false);
      expect(off2).toBeTruthy();
    });
  });

  // ─── setContext ─────────────────────────────────
  describe('setContext', () => {
    it('should include groups and claims in API URL after setContext', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await service._loadFeatures();
      mockFetch.mockClear();

      await service.setContext({
        identity: 'user-123',
        groups: ['beta', 'enterprise'],
        claims: { role: 'admin', plan: 'premium' },
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('g=beta');
      expect(url).toContain('g=enterprise');
      expect(url).toContain('claim.role=admin');
      expect(url).toContain('claim.plan=premium');
    });

    it('setContext with empty identity clears identity', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await service._loadFeatures();
      mockFetch.mockClear();

      await service.setContext({ identity: '' });

      expect((service as any)._config.identity).toBeUndefined();
    });

    it('setContext with only groups updates groups and refreshes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await service._loadFeatures();
      mockFetch.mockClear();

      await service.setContext({ groups: ['beta'] });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('g=beta');
    });

    it('setContext with empty groups omits g params on fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await service._loadFeatures();
      mockFetch.mockClear();

      await service.setContext({ groups: [] });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('g=');
    });

    it('setContext with only claims forces refresh', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: false }),
      });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        identity: 'user-123',
        enableLiveUpdates: false,
      });
      await service._loadFeatures();
      mockFetch.mockClear();

      await service.setContext({ claims: { role: 'admin' } });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('claim.role=admin');
      expect(await service.isFeatureOn('F1')).toBe(false);
    });
  });

  describe('Evaluation context from config', () => {
    it('should include groups and claims from init config', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ F1: true }),
      });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        groups: ['beta'],
        claims: { role: 'admin' },
        enableLiveUpdates: false,
      });
      await service._loadFeatures();

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('g=beta');
      expect(url).toContain('claim.role=admin');
    });

    it('should return cached features on 304 Not Modified', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
          headers: { get: () => '"rev-1"' },
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 304,
          statusText: 'Not Modified',
          json: () => Promise.resolve({}),
          headers: { get: () => null },
        });

      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        enableLiveUpdates: false,
      });
      await service._loadFeatures();
      await service._loadFeatures(true);

      expect(await service.isFeatureOn('F1')).toBe(true);
    });
  });

  // ─── WebSocket live updates ───────────────────────
  describe('WebSocket live updates', () => {
    let mockWsInstances: any[];
    const savedWebSocket = (globalThis as any).WebSocket;

    beforeEach(() => {
      vi.useFakeTimers();
      mockWsInstances = [];
      const MockWs = class {
        url: string;
        onopen: (() => void) | null = null;
        onmessage: ((e: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        closeCalled = false;
        constructor(url: string) {
          this.url = url;
          mockWsInstances.push(this);
        }
        close() { this.closeCalled = true; }
      };
      (globalThis as any).WebSocket = MockWs;
    });

    afterEach(() => {
      (globalThis as any).WebSocket = savedWebSocket;
      vi.useRealTimers();
    });

    function createWsService(config: any = {}) {
      const s = new Toggly();
      s.init(config);
      return s;
    }

    it('should not start WebSocket when no appKey', () => {
      const s = createWsService({ featureDefaults: { F1: true } });
      s.startWebSocket();
      expect(mockWsInstances).toHaveLength(0);
    });

    it('should not start WebSocket when enableLiveUpdates is false', () => {
      const s = createWsService({ appKey: 'k', environment: 'Prod', enableLiveUpdates: false });
      s.startWebSocket();
      expect(mockWsInstances).toHaveLength(0);
    });

    it('should build wss:// URL from https:// baseURI', () => {
      const s = createWsService({ appKey: 'mykey', environment: 'Prod' });
      s.startWebSocket();
      expect(mockWsInstances).toHaveLength(1);
      expect(mockWsInstances[0].url).toBe('wss://definitions.toggly.io/mykey/ws?sdk=vue&sdkVersion=1.4.1');
    });

    it('should build ws:// URL from http:// baseURI', () => {
      const s = createWsService({ appKey: 'mykey', baseURI: 'http://local.test', environment: 'Prod' });
      s.startWebSocket();
      expect(mockWsInstances[0].url).toBe('ws://local.test/mykey/ws?sdk=vue&sdkVersion=1.4.1');
    });

    it('should set _wsConnected on onopen', () => {
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onopen!();
      expect(s._wsConnected).toBe(true);
    });

    it('should refresh features on JSON flags-updated message', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'flags-updated' }) });
      vi.advanceTimersByTime(350);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should refresh features on JSON update message', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'update' }) });
      vi.advanceTimersByTime(350);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should ignore JSON ping message', () => {
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'ping' }) });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should ignore unknown JSON message type', () => {
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'unknown' }) });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh features on JSON sync message', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'sync', etag: 'new-rev' }) });
      vi.advanceTimersByTime(350);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should refresh features on signing-key-updated message', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: JSON.stringify({ type: 'signing-key-updated' }) });
      vi.advanceTimersByTime(350);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should cancel debounced refresh on stopWebSocket', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockFetch.mockClear();
      mockWsInstances[0].onmessage!({ data: 'update' });
      s.stopWebSocket();
      vi.advanceTimersByTime(350);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh features on plain text "update"', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: 'update' });
      vi.advanceTimersByTime(350);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should refresh features on plain text "flags-updated"', () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: 'flags-updated' });
      vi.advanceTimersByTime(350);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should ignore unrecognized plain text messages', () => {
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onmessage!({ data: 'heartbeat' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should log error on onerror', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      const err = new Event('error');
      mockWsInstances[0].onerror!(err);
      expect(errSpy).toHaveBeenCalledWith('[Toggly] WebSocket error:', err);
    });

    it('should schedule reconnect on onclose', () => {
      vi.useFakeTimers();
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onclose!();
      expect(s._wsConnected).toBe(false);
      vi.runAllTimers();
      expect(mockWsInstances).toHaveLength(2);
    });

    it('should close WebSocket on stopWebSocket', () => {
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      const ws = mockWsInstances[0];
      s.stopWebSocket();
      expect(ws.closeCalled).toBe(true);
      expect(s._wsConnected).toBe(false);
    });

    it('should cancel reconnect timer on stopWebSocket', () => {
      vi.useFakeTimers();
      const s = createWsService({ appKey: 'k', environment: 'Prod' });
      s.startWebSocket();
      mockWsInstances[0].onclose!();
      expect(s._wsReconnectTimer).not.toBeNull();
      s.stopWebSocket();
      expect(s._wsReconnectTimer).toBeNull();
      vi.runAllTimers();
      expect(mockWsInstances).toHaveLength(1);
    });
  });

  // ─── Variants ─────────────────────────────────
  describe('Variants', () => {
    it('should fetch evaluated-variants-signed when enableVariants is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              V: { enabled: true, variant: 'A', configurationValue: { x: 1 } },
            },
          }),
      });
      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/test-key/Production',
        SDK_FETCH_OPTIONS,
      );
      expect(service.getVariant('V')).toEqual({ name: 'A', configurationValue: { x: 1 } });
      expect(service.getVariantValue('V')).toEqual({ x: 1 });
      expect(await service.isFeatureOn('V')).toBe(true);
    });

    it('should pass userId query when enableVariants and identity are set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ defs: {} }),
      });
      const service = new Toggly();
      service.init({
        appKey: 'k',
        environment: 'Production',
        enableVariants: true,
        identity: 'user@x',
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('userId=user%40x'), SDK_FETCH_OPTIONS);
    });

    it('getVariant returns null when enableVariants is false', () => {
      const service = new Toggly();
      service.init({ featureDefaults: { F: true } });
      expect(service.getVariant('F')).toBeNull();
      expect(service.getVariantValue('F')).toBeNull();
    });

    it('falls back to cached variants on API error when enableVariants', async () => {
      const appKey = 'test-key';
      const env = 'Production';
      const defs = { V: { enabled: true, variant: 'cached' } };
      localStorage.setItem(`toggly:variants:${appKey}:${env}`, JSON.stringify(defs));
      mockFetch.mockRejectedValueOnce(new Error('network'));

      const service = new Toggly();
      service.init({
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
      localStorage.removeItem(`toggly:variants:${appKey}:${env}`);
    });

    it('getVariant returns null when enabled but no variant name on def', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ defs: { V: { enabled: true } } }),
      });
      const service = new Toggly();
      service.init({
        appKey: 'k',
        environment: 'Production',
        enableVariants: true,
        enableLiveUpdates: false,
      });

      await service._loadFeatures();
      expect(service.getVariant('V')).toBeNull();
    });

    it('subscribeFeaturesRefresh runs after successful load', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        enableLiveUpdates: false,
      });

      const fn = vi.fn();
      service.subscribeFeaturesRefresh(fn);
      await service._loadFeatures();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('subscribeFeaturesRefresh can be unsubscribed', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({
        appKey: 'test-key',
        environment: 'Production',
        enableLiveUpdates: false,
      });

      const fn = vi.fn();
      const unsub = service.subscribeFeaturesRefresh(fn);
      await service._loadFeatures();
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      await (service as any)._refreshFeatures();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('subscribeFeaturesRefresh continues when a listener throws', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) });
      const service = new Toggly();
      service.init({
        appKey: 't',
        environment: 'Production',
        enableLiveUpdates: false,
      });

      const ok = vi.fn();
      service.subscribeFeaturesRefresh(() => {
        throw new Error('bad listener');
      });
      service.subscribeFeaturesRefresh(ok);
      await service._loadFeatures();
      expect(ok).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalled();
    });
  });
});
