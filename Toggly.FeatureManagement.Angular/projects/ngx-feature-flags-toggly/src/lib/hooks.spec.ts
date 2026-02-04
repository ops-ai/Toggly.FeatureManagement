import { TestBed } from '@angular/core/testing';
import { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import { TogglyService } from './toggly.service';
import { TogglyModule } from './toggly.module';
import { FeatureRequirement } from './models';

describe('TogglyService Hooks', () => {
  let service: TogglyService;
  let beforeEvalCalls: EvaluationSeriesData[] = [];
  let afterEvalCalls: EvaluationSeriesData[] = [];
  let beforeIdentifyCalls: IdentitySeriesData[] = [];
  let afterIdentifyCalls: IdentitySeriesData[] = [];
  let afterRefreshCalls: number = 0;

  const testHook: Hook = {
    getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
    beforeEvaluation: async (data) => { beforeEvalCalls.push(data); },
    afterEvaluation: async (data) => { afterEvalCalls.push(data); },
    beforeIdentify: async (data) => { beforeIdentifyCalls.push(data); },
    afterIdentify: async (data) => { afterIdentifyCalls.push(data); },
    afterRefresh: async () => { afterRefreshCalls++; }
  };

  beforeEach(() => {
    beforeEvalCalls = [];
    afterEvalCalls = [];
    beforeIdentifyCalls = [];
    afterIdentifyCalls = [];
    afterRefreshCalls = 0;

    TestBed.configureTestingModule({
      imports: [
        TogglyModule.forRoot({
          flagDefaults: { Feature1: true, Feature2: false },
          hooks: [testHook]
        })
      ]
    });

    service = TestBed.inject(TogglyService);
  });

  describe('Hook Registration', () => {
    it('should register hook via config', () => {
      service.isFeatureOn('Feature1');

      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    it('should register hook via addHook', () => {
      const newHook: Hook = {
        getMetadata: () => ({ name: 'NewHook', version: '1.0.0' }),
        beforeEvaluation: async (data) => { beforeEvalCalls.push(data); }
      };

      service.addHook(newHook);
      service.isFeatureOn('Feature1');

      // Original hook + new hook
      expect(beforeEvalCalls.length).toBe(2);
    });

    it('should remove hook via removeHook', () => {
      service.isFeatureOn('Feature1');
      expect(beforeEvalCalls.length).toBe(1);

      service.removeHook(testHook);
      service.isFeatureOn('Feature1');

      expect(beforeEvalCalls.length).toBe(1);
    });
  });

  describe('beforeEvaluation Hook', () => {
    it('should call beforeEvaluation on isFeatureOn', () => {
      service.isFeatureOn('Feature1');

      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKey).toBe('Feature1');
    });

    it('should call beforeEvaluation on isFeatureOff', () => {
      service.isFeatureOff('Feature2');

      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKey).toBe('Feature2');
    });

    it('should call beforeEvaluation on evaluateFeatureGate', () => {
      service.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.All);

      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKeys).toEqual(['Feature1', 'Feature2']);
    });
  });

  describe('afterEvaluation Hook', () => {
    it('should call afterEvaluation with result', () => {
      service.isFeatureOn('Feature1');

      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].featureKey).toBe('Feature1');
      expect(afterEvalCalls[0].result).toBe(true);
    });

    it('should call afterEvaluation for false result', () => {
      service.isFeatureOn('Feature2');

      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(false);
    });

    it('should call afterEvaluation for gate evaluation', () => {
      service.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.Any);

      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(true);
    });
  });

  describe('Identity Hooks', () => {
    it('should call identity hooks on setIdentity', (done) => {
      service.setIdentity('user123', { email: 'test@example.com' }).then(() => {
        expect(beforeIdentifyCalls.length).toBe(1);
        expect(beforeIdentifyCalls[0].userId).toBe('user123');
        expect(beforeIdentifyCalls[0].context).toEqual({ email: 'test@example.com' });

        expect(afterIdentifyCalls.length).toBe(1);
        done();
      });
    });

    it('should call identity hooks on clearIdentity', (done) => {
      service.setIdentity('user123').then(() => {
        beforeIdentifyCalls = [];
        afterIdentifyCalls = [];

        service.clearIdentity().then(() => {
          expect(beforeIdentifyCalls.length).toBe(1);
          expect(afterIdentifyCalls.length).toBe(1);
          done();
        });
      });
    });
  });

  describe('afterRefresh Hook', () => {
    it('should call afterRefresh', (done) => {
      service.refresh().then(() => {
        expect(afterRefreshCalls).toBe(1);
        done();
      });
    });
  });

  describe('Multiple Hooks Execution Order', () => {
    it('should execute hooks in correct order', () => {
      const callOrder: string[] = [];

      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1', version: '1.0.0' }),
        beforeEvaluation: async () => { callOrder.push('hook1-before'); },
        afterEvaluation: async () => { callOrder.push('hook1-after'); }
      };

      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2', version: '1.0.0' }),
        beforeEvaluation: async () => { callOrder.push('hook2-before'); },
        afterEvaluation: async () => { callOrder.push('hook2-after'); }
      };

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [
          TogglyModule.forRoot({
            flagDefaults: { Feature1: true },
            hooks: [hook1, hook2]
          })
        ]
      });

      const testService = TestBed.inject(TogglyService);
      testService.isFeatureOn('Feature1');

      expect(callOrder).toEqual([
        'hook1-before',
        'hook2-before',
        'hook2-after',
        'hook1-after'
      ]);
    });
  });

  describe('Hook Error Isolation', () => {
    it('should not fail evaluation when hook throws', () => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        beforeEvaluation: async () => { throw new Error('Hook error'); }
      };

      service.addHook(errorHook);
      const result = service.isFeatureOn('Feature1');

      expect(result).toBe(true);
      expect(afterEvalCalls.length).toBe(1);
    });
  });

  describe('Performance', () => {
    it('should handle 100 hook executions efficiently', () => {
      const performanceHook: Hook = {
        getMetadata: () => ({ name: 'PerfHook', version: '1.0.0' }),
        beforeEvaluation: async () => {},
        afterEvaluation: async () => {}
      };

      service.addHook(performanceHook);

      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        service.isFeatureOn('Feature1');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100);
    });

    it('should handle multiple hooks efficiently', () => {
      const hooks: Hook[] = Array.from({ length: 5 }, (_, i) => ({
        getMetadata: () => ({ name: `Hook${i}`, version: '1.0.0' }),
        beforeEvaluation: async () => {},
        afterEvaluation: async () => {}
      }));

      hooks.forEach(hook => service.addHook(hook));

      const startTime = performance.now();

      for (let i = 0; i < 50; i++) {
        service.isFeatureOn('Feature1');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100);
    });
  });
});
