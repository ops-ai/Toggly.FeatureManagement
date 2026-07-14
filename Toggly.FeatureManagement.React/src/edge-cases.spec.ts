import { Toggly } from './services/toggly.service';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('Edge Cases & Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Network Errors ──────────────────────
  describe('Network Errors', () => {
    it('should handle 404 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('Not JSON')),
      });

      const service = new Toggly({
        appKey: 'bad-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle TypeError (network disconnect)', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle AbortError', async () => {
      mockFetch.mockRejectedValue(
        new DOMException('Aborted', 'AbortError')
      );

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });
  });

  // ─── Invalid Data ──────────────────────
  describe('Invalid Data', () => {
    it('should handle malformed JSON', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle null response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(JSON.stringify(null)),
      });

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      // null features stored, then evaluation: !null = true, Object.keys(null) throws
      // or null is stored and _evaluateFeatureGate handles it
      await expect(service._loadFeatures()).resolves.toBeDefined();
    });

    it('should handle empty object response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      // Empty remote features fail closed for non-empty gates.
      const result = await service.isFeatureOn('F1');
      expect(result).toBe(false);
    });
  });

  // ─── Feature Key Edge Cases ──────────────────────
  describe('Feature Key Edge Cases', () => {
    let service: Toggly;

    beforeEach(() => {
      mockFetch.mockRejectedValue(new Error('no network'));
      service = new Toggly({
        featureDefaults: {
          '': true,
          'feature.with.dots': true,
          'feature/slashes': true,
          'UPPERCASE': true,
          'lowercase': false,
          '🚀emoji': true,
        },
      });
    });

    it('should handle empty string key', async () => {
      const result = await service.isFeatureOn('');
      expect(result).toBe(true);
    });

    it('should handle keys with dots', async () => {
      const result = await service.isFeatureOn('feature.with.dots');
      expect(result).toBe(true);
    });

    it('should handle keys with slashes', async () => {
      const result = await service.isFeatureOn('feature/slashes');
      expect(result).toBe(true);
    });

    it('should be case-sensitive', async () => {
      const upper = await service.isFeatureOn('UPPERCASE');
      const lower = await service.isFeatureOn('uppercase');
      expect(upper).toBe(true);
      expect(lower).toBeFalsy();
    });

    it('should handle emoji keys', async () => {
      const result = await service.isFeatureOn('🚀emoji');
      expect(result).toBe(true);
    });

    it('should return falsy for non-existent keys', async () => {
      const on = await service.isFeatureOn('does-not-exist');
      const off = await service.isFeatureOff('does-not-exist');
      expect(on).toBeFalsy();
      expect(off).toBe(true);
    });
  });

  // ─── Feature Gate Edge Cases ──────────────────────
  describe('Feature Gate Edge Cases', () => {
    let service: Toggly;

    beforeEach(() => {
      mockFetch.mockRejectedValue(new Error('no network'));
      service = new Toggly({
        featureDefaults: { F1: true, F2: false, F3: true },
      });
    });

    it('should handle gate with all undefined features', async () => {
      const result = await service.evaluateFeatureGate(['X1', 'X2'], 'all', false);
      expect(result).toBeFalsy();
    });

    it('should handle gate with duplicate keys', async () => {
      const result = await service.evaluateFeatureGate(['F1', 'F1', 'F1'], 'all', false);
      expect(result).toBe(true);
    });

    it('should handle gate with mixed defined/undefined', async () => {
      const result = await service.evaluateFeatureGate(['F1', 'Unknown'], 'all', false);
      expect(result).toBeFalsy();
    });

    it('should handle single-item gate', async () => {
      const result = await service.evaluateFeatureGate(['F1'], 'all', false);
      expect(result).toBe(true);
    });

    it('should handle negate with all false', async () => {
      const result = await service.evaluateFeatureGate(['F2'], 'any', true);
      expect(result).toBe(true);
    });

    it('should handle large gate (100+ features)', async () => {
      const keys = Array.from({ length: 100 }, (_, i) => `F${i}`);
      await expect(service.evaluateFeatureGate(keys, 'any', false)).resolves.toBeDefined();
    });
  });

  // ─── Configuration Edge Cases ──────────────────────
  describe('Configuration Edge Cases', () => {
    it('should handle no appKey and no defaults', () => {
      const service = new Toggly({});
      expect(service).toBeTruthy();
    });

    it('should handle appKey without environment', () => {
      mockFetch.mockRejectedValue(new Error('no net'));
      const service = new Toggly({ appKey: 'test-key' });
      expect(service).toBeTruthy();
    });

    it('should handle re-construction with different config', async () => {
      mockFetch.mockRejectedValue(new Error('no net'));
      const s1 = new Toggly({ featureDefaults: { F1: true } });
      expect(await s1.isFeatureOn('F1')).toBe(true);

      const s2 = new Toggly({ featureDefaults: { F1: false, F2: true } });
      expect(await s2.isFeatureOn('F1')).toBeFalsy();
      expect(await s2.isFeatureOn('F2')).toBe(true);
    });

    it('should handle showFeatureDuringEvaluation flag', () => {
      const service = new Toggly({
        featureDefaults: { F1: true },
        showFeatureDuringEvaluation: true,
      });
      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });
  });

  // ─── Concurrency Edge Cases ──────────────────────
  describe('Concurrency Edge Cases', () => {
    it('should handle concurrent isFeatureOn calls', async () => {
      let resolvePromise: (v: any) => void;
      const pending = new Promise(resolve => { resolvePromise = resolve; });
      mockFetch.mockReturnValue(pending);

      const service = new Toggly({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const p1 = service.isFeatureOn('F1');
      const p2 = service.isFeatureOn('F1');

      resolvePromise!({
        ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
          text: () => Promise.resolve(JSON.stringify({ F1: true })),
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    });
  });

  // ─── Hook Edge Cases ──────────────────────
  describe('Hook Edge Cases', () => {
    const createTestHook = (name: string, overrides: any = {}) => ({
      getMetadata: () => ({ name }),
      ...overrides,
    });

    it('should handle hook that throws during evaluation', async () => {
      mockFetch.mockRejectedValue(new Error('no net'));
      const service = new Toggly({
        featureDefaults: { F1: true },
        hooks: [createTestHook('error-hook', {
          beforeEvaluation: async () => { throw new Error('hook error'); },
        }) as any],
      });

      // Should not crash despite hook error
      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle adding and removing hooks dynamically', () => {
      const service = new Toggly({ featureDefaults: {} });
      service.addHook(createTestHook('test-hook') as any);
      expect(service.removeHook('test-hook')).toBe(true);
      expect(service.removeHook('non-existent')).toBe(false);
    });
  });
});
