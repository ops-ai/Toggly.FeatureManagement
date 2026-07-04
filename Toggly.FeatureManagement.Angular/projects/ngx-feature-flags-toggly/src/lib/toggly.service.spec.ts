import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TogglyService } from './toggly.service';
import { TogglyOptions } from './toggly-options';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import type { Hook } from '@ops-ai/toggly-hooks-types';

describe('TogglyService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ─── Constructor / Init ──────────────────────────
  describe('Constructor', () => {
    it('should be created', () => {
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      const service = TestBed.inject(TogglyService);
      expect(service).toBeTruthy();
    });

    it('should warn when no appKey and using featureDefaults', () => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      TestBed.inject(TogglyService);
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Using feature defaults')
      );
    });

    it('should warn when no appKey and no featureDefaults', () => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({})],
      });
      TestBed.inject(TogglyService);
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('valid application key is required')
      );
    });

    it('should warn about Production environment when appKey set without environment', () => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'test-key' })],
      });
      TestBed.inject(TogglyService);
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Using Production environment')
      );
    });

    it('should not warn about Production when environment is specified', () => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Staging' })],
      });
      TestBed.inject(TogglyService);
      const prodWarns = (console.warn as jasmine.Spy).calls.allArgs().filter(
        (args: any[]) => String(args[0]).includes('Production environment')
      );
      expect(prodWarns.length).toBe(0);
    });

    it('should not warn when customDefinitionsUrl is set', () => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ customDefinitionsUrl: 'https://custom.api/flags' })],
      });
      TestBed.inject(TogglyService);
      const appKeyWarns = (console.warn as jasmine.Spy).calls.allArgs().filter(
        (args: any[]) => String(args[0]).includes('application key')
      );
      expect(appKeyWarns.length).toBe(0);
    });

    it('should set shouldShowFeatureDuringEvaluation from config', () => {
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { F1: true },
          showFeatureDuringEvaluation: true,
        })],
      });
      const service = TestBed.inject(TogglyService);
      expect(service.shouldShowFeatureDuringEvaluation).toBe(true);
    });

    it('should default shouldShowFeatureDuringEvaluation to false', () => {
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      const service = TestBed.inject(TogglyService);
      expect(service.shouldShowFeatureDuringEvaluation).toBe(false);
    });

    it('should register hooks from config', async () => {
      const calls: string[] = [];
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { F1: true },
          hooks: [{
            getMetadata: () => ({ name: 'InitHook', version: '1.0.0' }),
            beforeEvaluation: async (key) => { calls.push(key); },
          }],
        })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });
  });

  // ─── Feature Loading ──────────────────────────
  describe('Feature Loading', () => {
    let fetchSpy: jasmine.Spy;

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, 'fetch');
      spyOn(console, 'warn');
    });

    it('should return defaults when no appKey', async () => {
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      const service = TestBed.inject(TogglyService);
      const result = await service.isFeatureOn('F1');
      expect(result).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should fetch from API when appKey set', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ ApiFlag: true }) } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Production' })],
      });
      const service = TestBed.inject(TogglyService);
      const result = await service.isFeatureOn('ApiFlag');
      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith('https://definitions.toggly.io/evaluated-signed/key/Production');
    });

    it('should include identity in API URL', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key', environment: 'Production', identity: 'user-1',
        })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(fetchSpy).toHaveBeenCalledWith('https://definitions.toggly.io/evaluated-signed/key/Production?u=user-1');
    });

    it('should use custom baseURI', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          baseURI: 'https://custom.api', appKey: 'key', environment: 'Staging',
        })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(fetchSpy).toHaveBeenCalledWith('https://custom.api/evaluated-signed/key/Staging');
    });

    it('should use customDefinitionsUrl when set', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          customDefinitionsUrl: 'https://my-custom.api/flags',
        })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(fetchSpy).toHaveBeenCalledWith('https://my-custom.api/flags');
    });

    it('should fall back to featureDefaults on error', async () => {
      fetchSpy.and.rejectWith(new Error('Network error'));
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key', environment: 'Production',
          featureDefaults: { Fallback: true },
        })],
      });
      const service = TestBed.inject(TogglyService);
      const result = await service.isFeatureOn('Fallback');
      expect(result).toBe(true);
    });

    it('should fail closed when no defaults are available on error', async () => {
      fetchSpy.and.rejectWith(new Error('Network error'));
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Production' })],
      });
      const service = TestBed.inject(TogglyService);
      // Empty features fail closed for non-empty gates.
      const result = await service.isFeatureOn('Any');
      expect(result).toBe(false);
    });

    it('should cache features after first load', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Production' })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      await service.isFeatureOn('F1');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should not duplicate API calls during concurrent loading', async () => {
      let resolveFirst: (v: any) => void;
      const slowPromise = new Promise((r) => { resolveFirst = r; });

      fetchSpy.and.returnValue(
        slowPromise.then(() => ({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) }))
      );

      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Production' })],
      });
      const service = TestBed.inject(TogglyService);

      // Trigger two concurrent loads
      const load1 = service.isFeatureOn('F1');
      const load2 = service.isFeatureOn('F1');
      resolveFirst!(undefined);

      const [r1, r2] = await Promise.all([load1, load2]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should trigger afterRefresh hooks', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ F1: true }) } as any);
      let refreshed: any = null;
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key', environment: 'Production',
          hooks: [{
            getMetadata: () => ({ name: 'RefHook', version: '1.0.0' }),
            afterRefresh: async (flags) => { refreshed = flags; },
          }],
        })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(refreshed).toEqual({ F1: true     });
  });

  // ─── Reliability ──────────────────────────
  describe('Reliability', () => {
    let fetchSpy: jasmine.Spy;

    beforeEach(() => {
      localStorage.clear();
      fetchSpy = spyOn(globalThis, 'fetch');
      spyOn(console, 'warn');
    });

    it('should expose lastError and invoke onError when fetch fails', async () => {
      const errors: string[] = [];
      fetchSpy.and.rejectWith(new Error('network'));

      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          featureDefaults: { F1: true },
          onError: (message) => errors.push(message),
        })],
      });
      const service = TestBed.inject(TogglyService);

      await service.isFeatureOn('F1');
      expect(errors).toContain('Error fetching feature flags');
      expect(service.lastError).toBe('Error fetching feature flags');
    });

    it('should reject non-2xx responses', async () => {
      fetchSpy.and.resolveTo({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ F1: true }),
      } as any);

      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          featureDefaults: { F1: true },
        })],
      });
      const service = TestBed.inject(TogglyService);

      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should load variant defs when enableVariants is true', async () => {
      fetchSpy.and.resolveTo({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({
          defs: { Checkout: { enabled: true, variant: 'B' } },
        }),
      } as any);

      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          enableVariants: true,
        })],
      });
      const service = TestBed.inject(TogglyService);

      expect(await service.getVariant('Checkout')).toEqual(
        jasmine.objectContaining({ name: 'B' }),
      );
    });

    it('should seed variant cache from localStorage on init', async () => {
      localStorage.setItem(
        'toggly:variants:key:Production',
        JSON.stringify({ Cached: { enabled: true, variant: 'A' } }),
      );
      fetchSpy.and.rejectWith(new Error('offline'));

      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          enableVariants: true,
        })],
      });
      const service = TestBed.inject(TogglyService);

      await service.isFeatureOn('Cached');
      expect(await service.getVariant('Cached')).toEqual(
        jasmine.objectContaining({ name: 'A' }),
      );
    });

    it('should preserve in-memory flags when forced refresh fails', async () => {
      fetchSpy.and.returnValues(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ F1: true }),
        }),
        Promise.reject(new Error('network down')),
      );

      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          persistCache: false,
        })],
      });
      const service = TestBed.inject(TogglyService);

      expect(await service.isFeatureOn('F1')).toBe(true);
      await (service as any)._loadFeatures(true);
      expect(await service.isFeatureOn('F1')).toBe(true);
    });
  });
});

  // ─── Feature Evaluation ──────────────────────────
  describe('Feature Evaluation', () => {
    let service: TogglyService;

    beforeEach(() => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { F1: true, F2: false, F3: true },
        })],
      });
      service = TestBed.inject(TogglyService);
    });

    it('should return true when all flags enabled (all)', async () => {
      const result = await service.evaluateFeatureGate(['F1', 'F3'], 'all', false);
      expect(result).toBe(true);
    });

    it('should return falsy when some disabled (all)', async () => {
      const result = await service.evaluateFeatureGate(['F1', 'F2'], 'all', false);
      expect(result).toBeFalsy();
    });

    it('should return true when any enabled (any)', async () => {
      const result = await service.evaluateFeatureGate(['F1', 'F2'], 'any', false);
      expect(result).toBe(true);
    });

    it('should return falsy when none enabled (any)', async () => {
      const result = await service.evaluateFeatureGate(['F2'], 'any', false);
      expect(result).toBeFalsy();
    });

    it('should negate result', async () => {
      const result = await service.evaluateFeatureGate(['F1'], 'all', true);
      expect(result).toBe(false);
    });

    it('should fail closed for empty features object with non-empty gate', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: {} })],
      });
      const emptyService = TestBed.inject(TogglyService);
      const result = await emptyService.evaluateFeatureGate(['F1'], 'all', false);
      expect(result).toBe(false);
    });

    it('should skip hooks for empty gate', async () => {
      const calls: string[] = [];
      service.addHook({
        getMetadata: () => ({ name: 'EH', version: '1.0.0' }),
        beforeEvaluation: async () => { calls.push('called'); },
      });
      await service.evaluateFeatureGate([], 'all', false);
      expect(calls.length).toBe(0);
    });

    it('should call hooks for non-empty gate', async () => {
      const calls: string[] = [];
      service.addHook({
        getMetadata: () => ({ name: 'GH', version: '1.0.0' }),
        beforeEvaluation: async (key) => { calls.push(`before:${key}`); },
        afterEvaluation: async (key) => { calls.push(`after:${key}`); },
      });
      await service.evaluateFeatureGate(['F1'], 'all', false);
      expect(calls).toEqual(['before:F1', 'after:F1']);
    });
  });

  // ─── isFeatureOn / isFeatureOff ──────────────────
  describe('isFeatureOn', () => {
    let service: TogglyService;

    beforeEach(() => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { F1: true, F2: false },
        })],
      });
      service = TestBed.inject(TogglyService);
    });

    it('should return true for enabled feature', async () => {
      expect(await service.isFeatureOn('F1')).toBe(true);
    });

    it('should return false for disabled feature', async () => {
      expect(await service.isFeatureOn('F2')).toBe(false);
    });

    it('should trigger hooks', async () => {
      const calls: string[] = [];
      service.addHook({
        getMetadata: () => ({ name: 'OnH', version: '1.0.0' }),
        beforeEvaluation: async (k) => { calls.push(k); },
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });
  });

  describe('isFeatureOff', () => {
    let service: TogglyService;

    beforeEach(() => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { F1: true, F2: false },
        })],
      });
      service = TestBed.inject(TogglyService);
    });

    it('should return truthy for disabled feature (negated)', async () => {
      expect(await service.isFeatureOff('F2')).toBeTruthy();
    });

    it('should return false for enabled feature (negated)', async () => {
      expect(await service.isFeatureOff('F1')).toBe(false);
    });
  });

  // ─── Variants ──────────────────────────
  describe('Variants', () => {
    let fetchSpy: jasmine.Spy;

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, 'fetch');
      spyOn(console, 'warn');
    });

    it('should return null from getVariant when enableVariants is false', async () => {
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      const service = TestBed.inject(TogglyService);
      expect(await service.getVariant('F1')).toBeNull();
      expect(await service.getVariantValue('F1')).toBeNull();
    });

    it('should fetch evaluated-variants-signed when enableVariants is true', async () => {
      fetchSpy.and.resolveTo({
        ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({
          F1: { enabled: true, variant: 'treatment-a', configurationValue: { x: 1 } },
        }),
      } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          enableVariants: true,
        })],
      });
      const service = TestBed.inject(TogglyService);
      const v = await service.getVariant('F1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://definitions.toggly.io/evaluated-variants-signed/key/Production',
      );
      expect(v).toEqual({ name: 'treatment-a', configurationValue: { x: 1 } });
      expect(await service.getVariantValue('F1')).toEqual({ x: 1 });
    });

    it('should return null when feature has no variant name', async () => {
      fetchSpy.and.resolveTo({
        ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({
          F1: { enabled: true },
        }),
      } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          appKey: 'key',
          environment: 'Production',
          enableVariants: true,
        })],
      });
      const service = TestBed.inject(TogglyService);
      expect(await service.getVariant('F1')).toBeNull();
      expect(await service.getVariantValue('F1')).toBeNull();
    });
  });

  // ─── Hook Management ──────────────────────────
  describe('Hook Management', () => {
    let service: TogglyService;

    beforeEach(() => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      service = TestBed.inject(TogglyService);
    });

    it('should add hook dynamically', async () => {
      const calls: string[] = [];
      service.addHook({
        getMetadata: () => ({ name: 'Dyn', version: '1.0.0' }),
        beforeEvaluation: async (k) => { calls.push(k); },
      });
      await service.isFeatureOn('F1');
      expect(calls).toContain('F1');
    });

    it('should remove hook and return true', () => {
      service.addHook({ getMetadata: () => ({ name: 'Rem', version: '1.0.0' }) });
      expect(service.removeHook('Rem')).toBe(true);
    });

    it('should return false for non-existent hook', () => {
      expect(service.removeHook('Nope')).toBe(false);
    });
  });

  // ─── Edge Cases ──────────────────────────────
  describe('Edge Cases', () => {
    it('should handle concurrent evaluations', async () => {
      spyOn(console, 'warn');
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { F1: true, F2: false },
        })],
      });
      const service = TestBed.inject(TogglyService);
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

    it('should default environment to Production in fetch URL', async () => {
      spyOn(console, 'warn');
      const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(
        { json: () => Promise.resolve({ F1: true }) } as any
      );
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key' })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(fetchSpy).toHaveBeenCalledWith('https://definitions.toggly.io/evaluated-signed/key/Production');
    });
  });

  // ─── WebSocket Live Updates ───────────────────────────
  describe('WebSocket live updates', () => {
    let mockWs: any;
    let wsMockCalls: any[];
    const OrigWebSocket = (globalThis as any).WebSocket;

    function installWsMock() {
      wsMockCalls = [];
      (globalThis as any).WebSocket = function(url: string) {
        mockWs = {
          url,
          onopen: null as any,
          onmessage: null as any,
          onclose: null as any,
          onerror: null as any,
          closeSpy: jasmine.createSpy('close'),
          close() { this.closeSpy(); },
        };
        wsMockCalls.push(mockWs);
        return mockWs;
      };
    }

    beforeEach(() => {
      mockWs = undefined;
      wsMockCalls = [];
      spyOn(console, 'warn');
      spyOn(console, 'error');
      installWsMock();
    });

    afterEach(() => {
      (globalThis as any).WebSocket = OrigWebSocket;
    });

    async function createWsService(baseURI?: string) {
      TestBed.resetTestingModule();
      spyOn(globalThis, 'fetch').and.resolveTo(
        { json: () => Promise.resolve({ F1: true }) } as any
      );
      const config: any = { appKey: 'key', environment: 'Test' };
      if (baseURI) config.baseURI = baseURI;
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot(config)],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      return service;
    }

    it('should not start WebSocket when no appKey', async () => {
      TestBed.resetTestingModule();
      spyOn(globalThis, 'fetch').and.callFake(() => Promise.reject(new Error('no net')));
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: { F1: true } })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(wsMockCalls.length).toBe(0);
    });

    it('should start WebSocket after successful feature load', async () => {
      await createWsService();
      expect(mockWs).toBeDefined();
      expect(mockWs.url).toContain('key/ws');
    });

    it('should use wss:// for https:// baseURI', async () => {
      await createWsService('https://custom.io');
      expect(mockWs.url).toBe('wss://custom.io/key/ws');
    });

    it('should use ws:// for http:// baseURI', async () => {
      await createWsService('http://local');
      expect(mockWs.url).toBe('ws://local/key/ws');
    });

    it('should handle WebSocket constructor throw', async () => {
      (globalThis as any).WebSocket = function() { throw new Error('WS not supported'); };
      TestBed.resetTestingModule();
      spyOn(globalThis, 'fetch').and.resolveTo(
        { json: () => Promise.resolve({ F1: true }) } as any
      );
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Test' })],
      });
      const service = TestBed.inject(TogglyService);
      await service.isFeatureOn('F1');
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Failed to create WebSocket'),
        jasmine.anything()
      );
    });

    it('should set _wsConnected=true on ws open', async () => {
      const service = await createWsService();
      mockWs.onopen();
      expect((service as any)._wsConnected).toBe(true);
    });

    it('should reload features on flags-updated message', async () => {
      const service = await createWsService();
      const fetchSpy = (globalThis.fetch as jasmine.Spy);
      const callsBefore = fetchSpy.calls.count();
      mockWs.onmessage({ data: JSON.stringify({ type: 'flags-updated' }) });
      await Promise.resolve();
      expect(fetchSpy.calls.count()).toBeGreaterThanOrEqual(callsBefore);
    });

    it('should reload features on update message', async () => {
      const service = await createWsService();
      const fetchSpy = (globalThis.fetch as jasmine.Spy);
      const callsBefore = fetchSpy.calls.count();
      mockWs.onmessage({ data: JSON.stringify({ type: 'update' }) });
      await Promise.resolve();
      expect(fetchSpy.calls.count()).toBeGreaterThanOrEqual(callsBefore);
    });

    it('should ignore ping message', async () => {
      const service = await createWsService();
      const fetchSpy = (globalThis.fetch as jasmine.Spy);
      const callsBefore = fetchSpy.calls.count();
      mockWs.onmessage({ data: JSON.stringify({ type: 'ping' }) });
      await Promise.resolve();
      expect(fetchSpy.calls.count()).toBe(callsBefore);
    });

    it('should warn on malformed WS message', async () => {
      await createWsService();
      mockWs.onmessage({ data: 'not-json' });
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('Failed to parse WebSocket message'),
        jasmine.anything()
      );
    });

    it('should log warn on WebSocket error', async () => {
      await createWsService();
      mockWs.onerror(new Event('error'));
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('WebSocket error'),
        jasmine.anything()
      );
    });

    it('should reset _wsConnected and _ws on close', async () => {
      const service = await createWsService();
      mockWs.onclose();
      expect((service as any)._wsConnected).toBe(false);
      expect((service as any)._ws).toBeNull();
    });

    it('should schedule reconnect on ws close', fakeAsync(async () => {
      const service = await createWsService();
      const firstWs = mockWs;
      mockWs.onclose();
      tick(6000);
      expect(wsMockCalls.length).toBeGreaterThan(1);
      expect(wsMockCalls[wsMockCalls.length - 1]).not.toBe(firstWs);
    }));

    it('should call ngOnDestroy to clean up WS', async () => {
      const service = await createWsService();
      service.ngOnDestroy();
      expect(mockWs.closeSpy).toHaveBeenCalled();
      expect((service as any)._wsConnected).toBe(false);
    });

    it('should cancel pending reconnect timer on ngOnDestroy', fakeAsync(async () => {
      const service = await createWsService();
      mockWs.onclose(); // schedules reconnect
      service.ngOnDestroy(); // should cancel the timer
      const wsCountAfterDestroy = wsMockCalls.length;
      tick(6000);
      expect(wsMockCalls.length).toBe(wsCountAfterDestroy); // no new WS
    }));
  });
});
