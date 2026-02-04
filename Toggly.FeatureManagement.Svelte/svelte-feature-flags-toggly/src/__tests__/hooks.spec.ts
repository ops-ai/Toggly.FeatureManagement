import { describe, it, expect, beforeEach } from 'vitest';
import { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import { Toggly } from '../services/toggly.service';

describe('TogglyService Hooks', () => {
  let service: Toggly;
  let beforeEvalCalls: EvaluationSeriesData[] = [];
  let afterEvalCalls: EvaluationSeriesData[] = [];
  let beforeIdentifyCalls: IdentitySeriesData[] = [];
  let afterIdentifyCalls: IdentitySeriesData[] = [];
  let afterRefreshCalls: number = 0;

  const testHook: Hook = {
    getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
    beforeEvaluation: async (flagKey, defaultValue) => { 
      beforeEvalCalls.push({ flagKey, defaultValue }); 
    },
    afterEvaluation: async (flagKey, data, result) => { 
      afterEvalCalls.push({ flagKey, data, result }); 
    },
    beforeIdentify: async (identity) => { 
      beforeIdentifyCalls.push({ identity }); 
    },
    afterIdentify: async (identity, data) => { 
      afterIdentifyCalls.push({ identity, data }); 
    },
    afterRefresh: async () => { afterRefreshCalls++; }
  };

  beforeEach(() => {
    beforeEvalCalls = [];
    afterEvalCalls = [];
    beforeIdentifyCalls = [];
    afterIdentifyCalls = [];
    afterRefreshCalls = 0;
    
    service = new Toggly({
      featureDefaults: { Feature1: true, Feature2: false },
      hooks: [testHook]
    });
  });

  describe('Hook Registration', () => {
    it('should register hook via config', async () => {
      await service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    it('should register hook via addHook', async () => {
      const newService = new Toggly({
        featureDefaults: { Feature1: true }
      });
      
      newService.addHook(testHook);
      await newService.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    it('should remove hook via removeHook', async () => {
      await service.isFeatureOn('Feature1');
      expect(beforeEvalCalls.length).toBe(1);

      service.removeHook('TestHook');
      await service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
    });
  });

  describe('beforeEvaluation Hook', () => {
    it('should call beforeEvaluation on isFeatureOn', async () => {
      await service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].featureKey).toBe('Feature1');
    });

    it('should call beforeEvaluation on evaluateFeatureGate', async () => {
      await service.evaluateFeatureGate(['Feature1', 'Feature2'], 'all', false);
      
      // Should call beforeEvaluation once for the gate (using first key)
      expect(beforeEvalCalls.length).toBe(1);
      expect(beforeEvalCalls[0].flagKey).toBe('Feature1');
    });
  });

  describe('afterEvaluation Hook', () => {
    it('should call afterEvaluation with result', async () => {
      await service.isFeatureOn('Feature1');
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(true);
    });

    it('should call afterEvaluation for gate evaluation', async () => {
      await service.evaluateFeatureGate(['Feature1', 'Feature2'], 'any', false);
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(true);
    });
  });

  describe('Multiple Hooks Execution Order', () => {
    it('should execute hooks in correct order', async () => {
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
    it('should not fail evaluation when hook throws', async () => {
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
    it('should handle 100 hook executions efficiently', async () => {
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
      
      expect(duration).toBeLessThan(1000);
    });
  });
});
