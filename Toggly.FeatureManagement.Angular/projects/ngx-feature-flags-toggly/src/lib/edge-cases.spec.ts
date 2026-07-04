import { TestBed } from '@angular/core/testing';
import { TogglyService } from './toggly.service';
import { TogglyOptions } from './toggly-options';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';

describe('Edge Cases & Error Handling', () => {
  let mockFetch: jasmine.Spy;

  beforeEach(() => {
    localStorage.clear()
    mockFetch = spyOn(globalThis, 'fetch');
    spyOn(console, 'warn');
    spyOn(console, 'error');
  });

  function createService(config: Partial<TogglyOptions>): TogglyService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NgxFeatureFlagsTogglyModule.forRoot(config as TogglyOptions)],
    });
    return TestBed.inject(TogglyService);
  }

  // ─── Network Errors ──────────────────────
  describe('Network Errors', () => {
    it('should handle 404 response', async () => {
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.reject(new Error('Not Found')),
        })
      );

      const service = createService({
        appKey: 'bad-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle TypeError (network disconnect)', async () => {
      mockFetch.and.returnValue(
        Promise.reject(new TypeError('Failed to fetch'))
      );

      const service = createService({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle AbortError', async () => {
      mockFetch.and.returnValue(
        Promise.reject(new DOMException('Aborted', 'AbortError'))
      );

      const service = createService({
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
      mockFetch.and.returnValue(
        Promise.resolve({
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
        })
      );

      const service = createService({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle empty object response', async () => {
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({}),
        })
      );

      const service = createService({
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
    let service: TogglyService;

    beforeEach(() => {
      mockFetch.and.callFake(() => Promise.reject(new Error('no network')));
      service = createService({
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
      expect(await service.isFeatureOn('')).toBe(true);
    });

    it('should handle keys with dots', async () => {
      expect(await service.isFeatureOn('feature.with.dots')).toBe(true);
    });

    it('should handle keys with slashes', async () => {
      expect(await service.isFeatureOn('feature/slashes')).toBe(true);
    });

    it('should be case-sensitive', async () => {
      expect(await service.isFeatureOn('UPPERCASE')).toBe(true);
      expect(await service.isFeatureOn('uppercase')).toBeFalsy();
    });

    it('should handle emoji keys', async () => {
      expect(await service.isFeatureOn('🚀emoji')).toBe(true);
    });

    it('should return falsy for non-existent keys', async () => {
      expect(await service.isFeatureOn('does-not-exist')).toBeFalsy();
      expect(await service.isFeatureOff('does-not-exist')).toBe(true);
    });
  });

  // ─── Feature Gate Edge Cases ──────────────────────
  describe('Feature Gate Edge Cases', () => {
    let service: TogglyService;

    beforeEach(() => {
      mockFetch.and.callFake(() => Promise.reject(new Error('no network')));
      service = createService({
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
      await expectAsync(
        service.evaluateFeatureGate(keys, 'any', false)
      ).toBeResolved();
    });
  });

  // ─── Configuration Edge Cases ──────────────────────
  describe('Configuration Edge Cases', () => {
    it('should handle no appKey and no defaults', () => {
      const service = createService({});
      expect(service).toBeTruthy();
    });

    it('should handle appKey without environment', () => {
      mockFetch.and.callFake(() => Promise.reject(new Error('no net')));
      const service = createService({ appKey: 'test-key' });
      expect(service).toBeTruthy();
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Production environment')
      );
    });

    it('should handle customDefinitionsUrl', async () => {
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
        })
      );

      const service = createService({
        customDefinitionsUrl: 'https://custom.api.io/flags',
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        jasmine.stringContaining('https://custom.api.io/flags')
      );
    });

    it('should handle showFeatureDuringEvaluation flag', () => {
      const service = createService({
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
      const pending = new Promise(resolve => {
        resolvePromise = resolve;
      });
      mockFetch.and.returnValue(pending);

      const service = createService({
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
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    });
  });

  // ─── Reliability ──────────────────────
  describe('Reliability', () => {
    it('should report fetch errors through onError and lastError', async () => {
      const errors: string[] = [];
      mockFetch.and.returnValue(Promise.reject(new TypeError('Failed to fetch')));

      const service = createService({
        appKey: 'test-key',
        featureDefaults: { F1: true },
        onError: (message) => errors.push(message),
      });

      await service.isFeatureOn('F1');
      expect(errors).toContain('Error fetching feature flags');
      expect(service.lastError).toBe('Error fetching feature flags');
    });

    it('should preserve last-known-good flags on transient refresh failure', async () => {
      mockFetch.and.returnValues(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
        }),
        Promise.reject(new Error('network down')),
      );

      const service = createService({
        appKey: 'test-key',
        persistCache: false,
      });

      expect(await service.isFeatureOn('F1')).toBe(true);
      mockFetch.calls.reset();
      mockFetch.and.returnValue(Promise.reject(new Error('network down')));
      await (service as any)._loadFeatures(true);
      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should fall back to cached variant defs when variants fetch fails', async () => {
      localStorage.setItem(
        'toggly:variants:test-key:Production',
        JSON.stringify({ VariantFlag: { enabled: true, variant: 'A' } }),
      );
      mockFetch.and.returnValue(Promise.reject(new Error('network')));

      const service = createService({
        appKey: 'test-key',
        environment: 'Production',
        enableVariants: true,
      });

      await service.isFeatureOn('VariantFlag');
      expect(await service.getVariant('VariantFlag')).toEqual(
        jasmine.objectContaining({ name: 'A' }),
      );
    });

    it('should reject non-2xx responses without caching error payload', async () => {
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: () => Promise.resolve({ defs: { BadFlag: true } }),
        }),
      );

      const service = createService({
        appKey: 'test-key',
        featureDefaults: { F1: true },
      });

      expect(await service.isFeatureOn('F1')).toBe(true);
      expect(localStorage.getItem('toggly:flags:test-key:Production')).toBeNull();
    });

    it('should notify features refresh listeners after load', async () => {
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
        }),
      );

      const service = createService({ appKey: 'test-key' });
      let notified = false;
      service.subscribeFeaturesRefresh(() => {
        notified = true;
      });

      await service.isFeatureOn('F1');
      expect(notified).toBe(true);
    });
  });

  // ─── Hook Edge Cases ──────────────────────
  describe('Hook Edge Cases', () => {
    function createTestHook(name: string, overrides: any = {}): any {
      return {
        getMetadata: () => ({ name }),
        ...overrides,
      };
    }

    it('should handle hook that throws during evaluation', async () => {
      mockFetch.and.callFake(() => Promise.reject(new Error('no net')));
      const service = createService({
        featureDefaults: { F1: true },
        hooks: [createTestHook('error-hook', {
          beforeEvaluation: async () => { throw new Error('hook error'); },
        })],
      });

      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
    });

    it('should handle adding and removing hooks dynamically', () => {
      const service = createService({ featureDefaults: {} });
      service.addHook(createTestHook('test-hook'));
      expect(service.removeHook('test-hook')).toBe(true);
      expect(service.removeHook('non-existent')).toBe(false);
    });
  });
});
