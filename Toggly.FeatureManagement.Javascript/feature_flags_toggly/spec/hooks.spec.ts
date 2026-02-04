import { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
import { FeatureRequirement } from '../lib/models';
import { Toggly } from '../lib/toggly';

describe('Toggly Hooks', () => {
  let beforeEvalCalls: EvaluationSeriesData[] = [];
  let afterEvalCalls: any[] = [];
  let beforeIdentifyCalls: IdentitySeriesData[] = [];
  let afterIdentifyCalls: any[] = [];
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
    beforeIdentify: async (identity) => {
      const data = { identity };
      beforeIdentifyCalls.push(data);
      return data;
    },
    afterIdentify: async (identity, dataMap) => {
      afterIdentifyCalls.push({ identity, data: dataMap });
    },
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
    test('should register hook via config', (done) => {
      Toggly.init({
        flagDefaults: { TestFeature: true },
        hooks: [testHook]
      }).then(() => {
        Toggly.isFeatureOn('TestFeature');
        
        setTimeout(() => {
          try {
            expect(beforeEvalCalls.length).toBe(1);
            expect(afterEvalCalls.length).toBe(1);
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });

    test('should register hook via addHook', (done) => {
      Toggly.init({ flagDefaults: { TestFeature: true } }).then(() => {
        Toggly.addHook(testHook);

        Toggly.isFeatureOn('TestFeature');
        
        setTimeout(() => {
          try {
            expect(beforeEvalCalls.length).toBe(1);
            expect(afterEvalCalls.length).toBe(1);
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });

    test('should remove hook via removeHook', async () => {
      await Toggly.init({
        flagDefaults: { TestFeature: true },
        hooks: [testHook]
      });

      Toggly.isFeatureOn('TestFeature');
      expect(beforeEvalCalls.length).toBe(1);

      Toggly.removeHook('TestHook');
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
      // Reset counters after init to avoid counting initialization calls
      beforeEvalCalls = [];
      afterEvalCalls = [];
    });

    test('should call beforeEvaluation on isFeatureOn', (done) => {
      Toggly.isFeatureOn('Feature1');
      
      setTimeout(() => {
        try {
          expect(beforeEvalCalls.length).toBe(1);
          expect(beforeEvalCalls[0].flagKey).toBe('Feature1');
          expect(beforeEvalCalls[0].context).toBeUndefined();
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    test('should call beforeEvaluation on isFeatureOff', (done) => {
      Toggly.isFeatureOff('Feature2');
      
      setTimeout(() => {
        try {
          expect(beforeEvalCalls.length).toBe(1);
          expect(beforeEvalCalls[0].flagKey).toBe('Feature2');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    test('should call beforeEvaluation on evaluateFeatureGate', (done) => {
      Toggly.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.all);
      
      setTimeout(() => {
        try {
          expect(beforeEvalCalls.length).toBe(1);
          expect(beforeEvalCalls[0].flagKey).toBe('Feature1');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });
  });

  describe('afterEvaluation Hook', () => {
    beforeEach(async () => {
      await Toggly.init({
        flagDefaults: { Feature1: true, Feature2: false },
        hooks: [testHook]
      });
      // Reset counters after init
      beforeEvalCalls = [];
      afterEvalCalls = [];
    });

    test('should call afterEvaluation with result', (done) => {
      Toggly.isFeatureOn('Feature1');
      
      setTimeout(() => {
        try {
          expect(afterEvalCalls.length).toBe(1);
          expect(afterEvalCalls[0].flagKey).toBe('Feature1');
          expect(afterEvalCalls[0].result).toBe(true);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    test('should call afterEvaluation for false result', (done) => {
      Toggly.isFeatureOn('Feature2');
      
      setTimeout(() => {
        try {
          expect(afterEvalCalls.length).toBe(1);
          expect(afterEvalCalls[0].flagKey).toBe('Feature2');
          expect(afterEvalCalls[0].result).toBe(false);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    test('should call afterEvaluation for gate evaluation', (done) => {
      const result = Toggly.evaluateFeatureGate(['Feature1', 'Feature2'], FeatureRequirement.any);
      
      setTimeout(() => {
        try {
          expect(afterEvalCalls.length).toBe(1);
          expect(afterEvalCalls[0].flagKey).toBe('Feature1');
          expect(afterEvalCalls[0].result).toBe(true);
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });
  });

  describe('Identity Hooks', () => {
    beforeEach(async () => {
      await Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });
      // Reset counters after init
      beforeIdentifyCalls = [];
      afterIdentifyCalls = [];
    });

    test('should call identity hooks when setting identity', (done) => {
      Toggly.identity = 'user123';
      
      // Give hooks time to execute (fire-and-forget pattern)
      setTimeout(() => {
        try {
          expect(beforeIdentifyCalls.length).toBe(1);
          expect(beforeIdentifyCalls[0].identity).toBe('user123');
          
          expect(afterIdentifyCalls.length).toBe(1);
          expect(afterIdentifyCalls[0].identity).toBe('user123');
          done();
        } catch (error) {
          done(error);
        }
      }, 200);
    });

    test('should call beforeIdentify and afterIdentify on clearIdentity', (done) => {
      Toggly.identity = 'user123';
      
      // Wait for the first identity hooks to complete
      setTimeout(() => {
        beforeIdentifyCalls = [];
        afterIdentifyCalls = [];
        
        Toggly.clearIdentity();
        
        // Give hooks time to execute (fire-and-forget pattern)
        setTimeout(() => {
          try {
            expect(beforeIdentifyCalls.length).toBe(1);
            expect(beforeIdentifyCalls[0].identity).toBe('');
            
            expect(afterIdentifyCalls.length).toBe(1);
            expect(afterIdentifyCalls[0].identity).toBe('');
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      }, 200);
    });
  });

  describe('afterRefresh Hook', () => {
    test('should call afterRefresh when definitions are refreshed', (done) => {
      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      }).then(() => {
        // Reset counter after init
        afterRefreshCalls = 0;
        return Toggly.refresh();
      }).then(() => {
        // Wait for fire-and-forget hooks to complete
        setTimeout(() => {
          try {
            expect(afterRefreshCalls).toBe(1);
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });
  });

  describe('Multiple Hooks', () => {
    test('should execute multiple hooks in order (FIFO for before)', (done) => {
      const callOrder: string[] = [];
      
      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1', version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => { 
          callOrder.push('hook1-before'); 
          return { flagKey, defaultValue };
        },
        afterEvaluation: async (flagKey, dataMap, result) => { 
          callOrder.push('hook1-after'); 
        }
      };
      
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2', version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => { 
          callOrder.push('hook2-before'); 
          return { flagKey, defaultValue };
        },
        afterEvaluation: async (flagKey, dataMap, result) => { 
          callOrder.push('hook2-after'); 
        }
      };

      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [hook1, hook2]
      }).then(() => {
        Toggly.isFeatureOn('Feature1');
        
        // Give fire-and-forget hooks time to complete
        setTimeout(() => {
          try {
            // FIFO for before, LIFO for after
            expect(callOrder).toEqual([
              'hook1-before',
              'hook2-before',
              'hook2-after',
              'hook1-after'
            ]);
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });
  });

  describe('Hook Error Isolation', () => {
    test('should not fail evaluation when hook throws error', (done) => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => { throw new Error('Hook error'); }
      };

      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [errorHook, testHook]
      }).then(() => {
        // Should not throw
        const result = Toggly.isFeatureOn('Feature1');
        
        expect(result).toBe(true);
        
        // Give hooks time to execute
        setTimeout(() => {
          try {
            // Second hook should still execute
            expect(afterEvalCalls.length).toBe(1);
            done();
          } catch (error) {
            done(error);
          }
        }, 200);
      });
    });

    test('should not fail when afterEvaluation hook throws', (done) => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        afterEvaluation: async (flagKey, dataMap, result) => { throw new Error('Hook error'); }
      };

      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [errorHook]
      }).then(() => {
        // Should not throw
        expect(() => Toggly.isFeatureOn('Feature1')).not.toThrow();
        done();
      });
    });
  });

  describe('Hook Context Propagation', () => {
    test('should pass context from beforeEvaluation to afterEvaluation', (done) => {
      let capturedData: (EvaluationSeriesData & { timestamp: number }) | undefined;
      let beforeCalled = false;
      let afterCalled = false;
      
      const contextHook: Hook = {
        getMetadata: () => ({ name: 'ContextHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => {
          beforeCalled = true;
          return { flagKey, defaultValue, timestamp: Date.now() };
        },
        afterEvaluation: async (flagKey, data, result) => {
          afterCalled = true;
          // data is the return value from beforeEvaluation for this specific hook
          if (data) {
            capturedData = data as (EvaluationSeriesData & { timestamp: number });
          }
        }
      };

      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [contextHook]
      }).then(() => {
        Toggly.isFeatureOn('Feature1');
        
        // Give fire-and-forget hooks time to complete (async in sync context)
        setTimeout(() => {
          try {
            expect(beforeCalled).toBe(true);
            expect(afterCalled).toBe(true);
            expect(capturedData).toBeDefined();
            expect(capturedData!.flagKey).toBe('Feature1');
            expect(capturedData!.timestamp).toBeDefined();
            done();
          } catch (error) {
            done(error);
          }
        }, 1000);
      });
    });
  });

  describe('Performance', () => {
    test('should handle 100 hook executions efficiently', (done) => {
      const performanceHook: Hook = {
        getMetadata: () => ({ name: 'PerfHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => ({ flagKey, defaultValue }),
        afterEvaluation: async (flagKey, dataMap, result) => {}
      };

      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks: [performanceHook]
      }).then(() => {
        const startTime = performance.now();
        
        for (let i = 0; i < 100; i++) {
          Toggly.isFeatureOn('Feature1');
        }
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        // Should complete 100 evaluations in under 100ms
        expect(duration).toBeLessThan(100);
        done();
      });
    });

    test('should handle multiple hooks without significant overhead', (done) => {
      const hooks: Hook[] = Array.from({ length: 5 }, (_, i) => ({
        getMetadata: () => ({ name: `Hook${i}`, version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => ({ flagKey, defaultValue }),
        afterEvaluation: async (flagKey, dataMap, result) => {}
      }));

      Toggly.init({
        flagDefaults: { Feature1: true },
        hooks
      }).then(() => {
        const startTime = performance.now();
        
        for (let i = 0; i < 50; i++) {
          Toggly.isFeatureOn('Feature1');
        }
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        // 50 evaluations with 5 hooks should complete in under 100ms
        expect(duration).toBeLessThan(100);
        done();
      });
    });
  });
});
