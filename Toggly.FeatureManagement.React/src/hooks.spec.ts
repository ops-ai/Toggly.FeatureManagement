import { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import Toggly from './services/toggly.service';

describe('TogglyService Hooks', () => {
  let service: Toggly;
  let beforeEvalCalls: EvaluationSeriesData[] = [];
  let afterEvalCalls: any[] = [];
  let afterRefreshCalls: number = 0;

  const testHook: Hook = {
    getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
    beforeEvaluation: async (flagKey, defaultValue) => { 
      const data = { flagKey, defaultValue };
      beforeEvalCalls.push(data);
      return data;
    },
    afterEvaluation: async (flagKey, dataMap, result) => { 
      afterEvalCalls.push({ flagKey, data: dataMap, result }); 
    },
    // Note: React SDK doesn't implement identity hooks
    afterRefresh: async () => { afterRefreshCalls++; }
  };

  beforeEach(() => {
    beforeEvalCalls = [];
    afterEvalCalls = [];
    afterRefreshCalls = 0;
    
    service = new Toggly({
      featureDefaults: { Feature1: true, Feature2: false },
      hooks: [testHook]
    });
  });

  describe('Hook Registration', () => {
    test('should register hook via config', async () => {
      await service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    test('should register hook via addHook', async () => {
      const newService = new Toggly({
        featureDefaults: { Feature1: true }
      });
      
      newService.addHook(testHook);
      await newService.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    test('should remove hook via removeHook', async () => {
      await service.isFeatureOn('Feature1');
      expect(beforeEvalCalls.length).toBe(1);

      service.removeHook('TestHook');
      await service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
    });
  });

  describe('beforeEvaluation Hook', () => {
    test('should call beforeEvaluation on isFeatureOn', async () => {
      await service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].flagKey).toBe('Feature1');
    });

    test('should call beforeEvaluation on isFeatureOff', async () => {
      await service.isFeatureOff('Feature2');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].flagKey).toBe('Feature2');
    });

    test('should call beforeEvaluation on evaluateFeatureGate', async () => {
      await service.evaluateFeatureGate(['Feature1', 'Feature2'], 'all');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].flagKey).toBe('Feature1');
    });
  });

  describe('afterEvaluation Hook', () => {
    test('should call afterEvaluation with result', async () => {
      await service.isFeatureOn('Feature1');
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].flagKey).toBe('Feature1');
      expect(afterEvalCalls[0].result).toBe(true);
    });

    test('should call afterEvaluation for false result', async () => {
      await service.isFeatureOn('Feature2');
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(false);
    });

    test('should call afterEvaluation for gate evaluation', async () => {
      await service.evaluateFeatureGate(['Feature1', 'Feature2'], 'any');
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(true);
    });
  });

  // Note: React SDK doesn't implement identity management or refresh functionality
  // describe('Identity Hooks', () => { ... })
  // describe('afterRefresh Hook', () => { ... })

  describe('Multiple Hooks Execution Order', () => {
    test('should execute hooks in correct order', async () => {
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

      const testService = new Toggly({
        featureDefaults: { Feature1: true },
        hooks: [hook1, hook2]
      });

      await testService.isFeatureOn('Feature1');
      
      expect(callOrder).toEqual([
        'hook1-before',
        'hook2-before',
        'hook2-after',
        'hook1-after'
      ]);
    });
  });

  describe('Hook Error Isolation', () => {
    test('should not fail evaluation when hook throws', async () => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        beforeEvaluation: async () => { throw new Error('Hook error'); }
      };

      const testService = new Toggly({
        featureDefaults: { Feature1: true },
        hooks: [errorHook, testHook]
      });

      const result = await testService.isFeatureOn('Feature1');
      
      expect(result).toBe(true);
      expect(afterEvalCalls.length).toBe(1);
    });
  });

  describe('Performance', () => {
    test('should handle 100 hook executions efficiently', async () => {
      const performanceHook: Hook = {
        getMetadata: () => ({ name: 'PerfHook', version: '1.0.0' }),
        beforeEvaluation: async () => {},
        afterEvaluation: async () => {}
      };

      const testService = new Toggly({
        featureDefaults: { Feature1: true },
        hooks: [performanceHook]
      });

      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        await testService.isFeatureOn('Feature1');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1000); // Increased for async
    });

    test('should handle multiple hooks efficiently', async () => {
      const hooks: Hook[] = Array.from({ length: 5 }, (_, i) => ({
        getMetadata: () => ({ name: `Hook${i}`, version: '1.0.0' }),
        beforeEvaluation: async () => {},
        afterEvaluation: async () => {}
      }));

      const testService = new Toggly({
        featureDefaults: { Feature1: true },
        hooks
      });

      const startTime = performance.now();
      
      for (let i = 0; i < 50; i++) {
        await testService.isFeatureOn('Feature1');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(500); // Increased for async
    });
  });
});
