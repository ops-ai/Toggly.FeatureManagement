import { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import { FeatureRequirement } from '../lib/models';
import { Toggly } from '../lib/toggly';

describe('Toggly Hooks', () => {
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
  });

  describe('Hook Registration', () => {
    test('should register hook via config', async () => {
      await Toggly.init({
        flagDefaults: { TestFeature: true },
        hooks: [testHook]
      });

      Toggly.isFeatureOn('TestFeature');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    test('should register hook via addHook', async () => {
      await Toggly.init({ flagDefaults: { TestFeature: true } });
      Toggly.addHook(testHook);

      Toggly.isFeatureOn('TestFeature');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    test('should remove hook via removeHook', async () => {
      await Toggly.init({
        flagDefaults: { TestFeature: true },
        hooks: [testHook]
      });

      Toggly.isFeatureOn('TestFeature');
      expect(beforeEvalCalls.length).toBe(1);

      Toggly.removeHook(testHook);
      Toggly.isFeatureOn('TestFeature');
      
      expect(beforeEvalCalls.length).toBe(1); // No new calls
    });
  });

  describe('beforeEvaluation Hook', () => {
    beforeEach(async () => {
      await Toggly.init({
        flagDefaults: { Feature1: true, Feature2: false },
        hooks: [testHook]
      });
    });

    test('should call beforeEvaluation on isFeatureOn', () => {
      Toggly.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKey).toBe('Feature1');
      expect(beforeEvalCalls[0].context).toBeUndefined();
    });

    test('should call beforeEvaluation on isFeatureOff', () => {
      Toggly.isFeatureOff('Feature2');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKey).toBe('Feature2');
    });

    test('should call beforeEvaluation on evaluateFeatureGate', () => {
      Toggly.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.all);
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKeys).toEqual(['Feature1', 'Feature2']);
      expect(beforeEvalCalls[0].requirement).toBe(FeatureRequirement.all);
    });
  });

  describe('afterEvaluation Hook', () => {
    beforeEach(async () => {
      await Toggly.init({
        flagDefaults: { Feature1: true, Feature2: false },
        hooks: [testHook]
      });
    });

    test('should call afterEvaluation with result', () => {
      Toggly.isFeatureOn('Feature1');
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].featureKey).toBe('Feature1');
      expect(afterEvalCalls[0].result).toBe(true);
    });

    test('should call afterEvaluation for false result', () => {
      Toggly.isFeatureOn('Feature2');
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].featureKey).toBe('Feature2');
      expect(afterEvalCalls[0].result).toBe(false);
    });

    test('should call afterEvaluation for gate evaluation', () => {
      const result = Toggly.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.any);
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].featureKeys).toEqual(['Feature1', 'Feature2']);
      expect(afterEvalCalls[0].result).toBe(true);
    });
  });

  describe('Identity Hooks', () => {
    beforeEach(async () => {
      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });
    });

    test('should call beforeIdentify and afterIdentify on setIdentity', async () => {
      await Toggly.setIdentity('user123', { email: 'test@example.com' });
      
      expect(beforeIdentifyCalls.length).toBe(1);
      expect(beforeIdentifyCalls[0].userId).toBe('user123');
      expect(beforeIdentifyCalls[0].context).toEqual({ email: 'test@example.com' });
      
      expect(afterIdentifyCalls.length).toBe(1);
      expect(afterIdentifyCalls[0].userId).toBe('user123');
    });

    test('should call beforeIdentify and afterIdentify on clearIdentity', async () => {
      await Toggly.setIdentity('user123');
      beforeIdentifyCalls = [];
      afterIdentifyCalls = [];
      
      await Toggly.clearIdentity();
      
      expect(beforeIdentifyCalls.length).toBe(1);
      expect(beforeIdentifyCalls[0].userId).toBeUndefined();
      
      expect(afterIdentifyCalls.length).toBe(1);
      expect(afterIdentifyCalls[0].userId).toBeUndefined();
    });
  });

  describe('afterRefresh Hook', () => {
    test('should call afterRefresh when definitions are refreshed', async () => {
      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });

      await Toggly.refresh();
      
      expect(afterRefreshCalls).toBe(1);
    });
  });

  describe('Multiple Hooks', () => {
    test('should execute multiple hooks in order (FIFO for before)', async () => {
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

      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [hook1, hook2]
      });

      Toggly.isFeatureOn('Feature1');
      
      // FIFO for before, LIFO for after
      expect(callOrder).toEqual([
        'hook1-before',
        'hook2-before',
        'hook2-after',
        'hook1-after'
      ]);
    });
  });

  describe('Hook Error Isolation', () => {
    test('should not fail evaluation when hook throws error', async () => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        beforeEvaluation: async () => { throw new Error('Hook error'); }
      };

      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [errorHook, testHook]
      });

      // Should not throw
      const result = Toggly.isFeatureOn('Feature1');
      
      expect(result).toBe(true);
      // Second hook should still execute
      expect(afterEvalCalls.length).toBe(1);
    });

    test('should not fail when afterEvaluation hook throws', async () => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        afterEvaluation: async () => { throw new Error('Hook error'); }
      };

      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [errorHook]
      });

      // Should not throw
      expect(() => Toggly.isFeatureOn('Feature1')).not.toThrow();
    });
  });

  describe('Hook Context Propagation', () => {
    test('should pass context from beforeEvaluation to afterEvaluation', async () => {
      let capturedContext: any;
      
      const contextHook: Hook = {
        getMetadata: () => ({ name: 'ContextHook', version: '1.0.0' }),
        beforeEvaluation: async (data) => {
          return { timestamp: Date.now() };
        },
        afterEvaluation: async (data) => {
          capturedContext = data.context;
        }
      };

      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [contextHook]
      });

      Toggly.isFeatureOn('Feature1');
      
      expect(capturedContext).toBeDefined();
      expect(capturedContext.timestamp).toBeDefined();
    });
  });

  describe('Performance', () => {
    test('should handle 100 hook executions efficiently', async () => {
      const performanceHook: Hook = {
        getMetadata: () => ({ name: 'PerfHook', version: '1.0.0' }),
        beforeEvaluation: async () => {},
        afterEvaluation: async () => {}
      };

      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [performanceHook]
      });

      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        Toggly.isFeatureOn('Feature1');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete 100 evaluations in under 100ms
      expect(duration).toBeLessThan(100);
    });

    test('should handle multiple hooks without significant overhead', async () => {
      const hooks: Hook[] = Array.from({ length: 5 }, (_, i) => ({
        getMetadata: () => ({ name: `Hook${i}`, version: '1.0.0' }),
        beforeEvaluation: async () => {},
        afterEvaluation: async () => {}
      }));

      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks
      });

      const startTime = performance.now();
      
      for (let i = 0; i < 50; i++) {
        Toggly.isFeatureOn('Feature1');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // 50 evaluations with 5 hooks should complete in under 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
