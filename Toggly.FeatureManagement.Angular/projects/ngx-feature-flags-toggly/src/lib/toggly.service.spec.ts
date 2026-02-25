import { TestBed } from '@angular/core/testing';
import { TogglyService } from './toggly.service';
import { TogglyOptions } from './toggly-options';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import type { Hook } from '@ops-ai/toggly-hooks-types';

describe('TogglyService', () => {
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
      fetchSpy.and.resolveTo({ json: () => Promise.resolve({ ApiFlag: true }) } as any);
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Production' })],
      });
      const service = TestBed.inject(TogglyService);
      const result = await service.isFeatureOn('ApiFlag');
      expect(result).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith('https://definitions.toggly.io/evaluated-signed/key/Production');
    });

    it('should include identity in API URL', async () => {
      fetchSpy.and.resolveTo({ json: () => Promise.resolve({ F1: true }) } as any);
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
      fetchSpy.and.resolveTo({ json: () => Promise.resolve({ F1: true }) } as any);
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
      fetchSpy.and.resolveTo({ json: () => Promise.resolve({ F1: true }) } as any);
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

    it('should fall back to empty object when no defaults on error', async () => {
      fetchSpy.and.rejectWith(new Error('Network error'));
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ appKey: 'key', environment: 'Production' })],
      });
      const service = TestBed.inject(TogglyService);
      // empty features → returns true (no features loaded guard)
      const result = await service.isFeatureOn('Any');
      expect(result).toBe(true);
    });

    it('should cache features after first load', async () => {
      fetchSpy.and.resolveTo({ json: () => Promise.resolve({ F1: true }) } as any);
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
        slowPromise.then(() => ({ json: () => Promise.resolve({ F1: true }) }))
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
      fetchSpy.and.resolveTo({ json: () => Promise.resolve({ F1: true }) } as any);
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
      expect(refreshed).toEqual({ F1: true });
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

    it('should return true for empty features object', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [NgxFeatureFlagsTogglyModule.forRoot({ featureDefaults: {} })],
      });
      const emptyService = TestBed.inject(TogglyService);
      const result = await emptyService.evaluateFeatureGate(['F1'], 'all', false);
      expect(result).toBe(true);
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
});
