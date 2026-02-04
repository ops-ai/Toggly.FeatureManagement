import { describe, it, expect, beforeEach } from 'vitest';
import { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import { TogglyService } from '../plugins/toggly.service';
import { FeatureRequirement } from '../models';

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
    
    service = new TogglyService({
      flagDefaults: { Feature1: true, Feature2: false },
      hooks: [testHook]
    });
  });

  describe('Hook Registration', () => {
    it('should register hook via config', () => {
      service.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
    });

    it('should register hook via addHook', () => {
      const newService = new TogglyService({
        flagDefaults: { Feature1: true }
      });
      
      newService.addHook(testHook);
      newService.isFeatureOn('Feature1');
      
      expect(beforeEvalCalls.length).toBe(1);
      expect(afterEvalCalls.length).toBe(1);
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
      expect(afterEvalCalls[0].result).toBe(true);
    });

    it('should call afterEvaluation for gate evaluation', () => {
      service.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.Any);
      
      expect(afterEvalCalls.length).toBe(1);
      expect(afterEvalCalls[0].result).toBe(true);
    });
  });

  describe('Identity Hooks', () => {
    it('should call identity hooks on setIdentity', async () => {
      await service.setIdentity('user123', { email: 'test@example.com' });
      
      expect(beforeIdentifyCalls.length).toBe(1);
      expect(beforeIdentifyCalls[0].userId).toBe('user123');
      expect(afterIdentifyCalls.length).toBe(1);
    });

    it('should call identity hooks on clearIdentity', async () => {
      await service.setIdentity('user123');
      beforeIdentifyCalls = [];
      afterIdentifyCalls = [];
      
      await service.clearIdentity();
      
      expect(beforeIdentifyCalls.length).toBe(1);
      expect(afterIdentifyCalls.length).toBe(1);
    });
  });

  describe('afterRefresh Hook', () => {
    it('should call afterRefresh', async () => {
      await service.refresh();
      
      expect(afterRefreshCalls).toBe(1);
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

      const testService = new TogglyService({
        flagDefaults: { Feature1: true },
        hooks: [hook1, hook2]
      });

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

      const testService = new TogglyService({
        flagDefaults: { Feature1: true },
        hooks: [errorHook, testHook]
      });

      const result = testService.isFeatureOn('Feature1');
      
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

      const testService = new TogglyService({
        flagDefaults: { Feature1: true },
        hooks: [performanceHook]
      });

      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        testService.isFeatureOn('Feature1');
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(100);
    });
  });
});
