import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hook } from '@ops-ai/toggly-hooks-types';
import { initTogglyClient, $flags, $isReady, addHook, removeHook, refreshFlags, __resetClient } from '../client/store';

describe('Astro Toggly Hooks', () => {
  let afterRefreshCalls: number = 0;

  const testHook: Hook = {
    getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
    afterRefresh: async () => { afterRefreshCalls++; }
  };

  beforeEach(() => {
    afterRefreshCalls = 0;
  });

  afterEach(() => {
    // Reset client for next test
    __resetClient();
  });

  describe('Hook Registration', () => {
    it('should register hook via config', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });

      // Hook is registered
      expect(afterRefreshCalls).toBe(1); // Called during init
    });

    it('should register hook via addHook', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true }
      });

      afterRefreshCalls = 0;
      
      const newHook: Hook = {
        getMetadata: () => ({ name: 'NewHook', version: '1.0.0' }),
        afterRefresh: async () => { afterRefreshCalls++; }
      };
      
      addHook(newHook);
      await refreshFlags();
      
      expect(afterRefreshCalls).toBe(1);
    });

    it('should remove hook via removeHook', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });

      afterRefreshCalls = 0;
      const result = removeHook('TestHook');
      expect(result).toBe(true);
      
      await refreshFlags();
      expect(afterRefreshCalls).toBe(0); // Hook was removed
    });
  });

  describe('afterRefresh Hook', () => {
    it('should call afterRefresh on init', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true, Feature2: false },
        hooks: [testHook]
      });

      expect(afterRefreshCalls).toBe(1);
      
      const flags = $flags.get();
      expect(flags.Feature1).toBe(true);
      expect(flags.Feature2).toBe(false);
    });

    it('should call afterRefresh when flags are refreshed', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });

      afterRefreshCalls = 0;
      await refreshFlags();
      
      expect(afterRefreshCalls).toBe(1);
    });

    it('should pass flags to afterRefresh', async () => {
      let capturedFlags: { [key: string]: boolean } | null = null;
      
      const captureHook: Hook = {
        getMetadata: () => ({ name: 'CaptureHook', version: '1.0.0' }),
        afterRefresh: async (flags) => {
          capturedFlags = flags;
        }
      };

      await initTogglyClient({
        environment: 'test',
        flagDefaults: { Feature1: true, Feature2: false },
        hooks: [captureHook]
      });

      expect(capturedFlags).toBeDefined();
      expect(capturedFlags!.Feature1).toBe(true);
      expect(capturedFlags!.Feature2).toBe(false);
    });
  });

  describe('Multiple Hooks', () => {
    it('should execute multiple hooks in order', async () => {
      const callOrder: string[] = [];
      
      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1', version: '1.0.0' }),
        afterRefresh: async () => { callOrder.push('hook1'); }
      };
      
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2', version: '1.0.0' }),
        afterRefresh: async () => { callOrder.push('hook2'); }
      };

      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks: [hook1, hook2]
      });

      expect(callOrder).toEqual(['hook1', 'hook2']);
    });
  });

  describe('Hook Error Isolation', () => {
    it('should not fail refresh when hook throws error', async () => {
      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        afterRefresh: async () => { throw new Error('Hook error'); }
      };

      // Should not throw
      await expect(initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks: [errorHook, testHook]
      })).resolves.not.toThrow();

      // Second hook should still execute
      expect(afterRefreshCalls).toBe(1);
      
      // Flags should still be set
      const flags = $flags.get();
      expect(flags.Feature1).toBe(true);
    });
  });

  describe('Reactive Flag Access', () => {
    it('should update flags store on init', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true, Feature2: false }
      });

      const flags = $flags.get();
      expect(flags.Feature1).toBe(true);
      expect(flags.Feature2).toBe(false);
      expect($isReady.get()).toBe(true);
    });

    it('should update flags store on refresh', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true }
      });

      const flagsBefore = $flags.get();
      expect(flagsBefore.Feature1).toBe(true);

      await refreshFlags();
      
      const flagsAfter = $flags.get();
      expect(flagsAfter.Feature1).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle multiple hooks efficiently', async () => {
      const hooks: Hook[] = Array.from({ length: 10 }, (_, i) => ({
        getMetadata: () => ({ name: `Hook${i}`, version: '1.0.0' }),
        afterRefresh: async () => {}
      }));

      const startTime = performance.now();
      
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks
      });
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete initialization with 10 hooks in reasonable time
      expect(duration).toBeLessThan(1000); // 1 second
    });

    it('should handle multiple refreshes efficiently', async () => {
      await initTogglyClient({
        appKey: undefined,
        environment: 'test',
        flagDefaults: { Feature1: true },
        hooks: [testHook]
      });

      afterRefreshCalls = 0;
      const startTime = performance.now();
      
      for (let i = 0; i < 10; i++) {
        await refreshFlags();
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // All hooks should have been called
      expect(afterRefreshCalls).toBe(10);
      
      // Should complete 10 refreshes in reasonable time
      expect(duration).toBeLessThan(1000); // 1 second
    });
  });
});
