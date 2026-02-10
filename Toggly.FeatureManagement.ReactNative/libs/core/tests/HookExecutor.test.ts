import { HookExecutor } from '../src/services/HookExecutor';
import type { Hook } from '@ops-ai/toggly-hooks-types';

describe('HookExecutor', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
  });

  describe('addHook', () => {
    it('should add a hook', () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'TestHook' }),
      };

      executor.addHook(hook);

      expect(executor.getHooks()).toHaveLength(1);
      expect(executor.getHooks()[0].getMetadata().name).toBe('TestHook');
    });

    it('should not add duplicate hooks with same name', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const hook1: Hook = {
        getMetadata: () => ({ name: 'TestHook' }),
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'TestHook' }),
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      expect(executor.getHooks()).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );

      consoleSpy.mockRestore();
    });

    it('should add multiple hooks with different names', () => {
      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1' }),
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2' }),
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      expect(executor.getHooks()).toHaveLength(2);
    });
  });

  describe('removeHook', () => {
    it('should remove a hook by name', () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'TestHook' }),
      };

      executor.addHook(hook);
      const removed = executor.removeHook('TestHook');

      expect(removed).toBe(true);
      expect(executor.getHooks()).toHaveLength(0);
    });

    it('should return false when hook not found', () => {
      const removed = executor.removeHook('NonexistentHook');
      expect(removed).toBe(false);
    });
  });

  describe('clearHooks', () => {
    it('should remove all hooks', () => {
      executor.addHook({ getMetadata: () => ({ name: 'Hook1' }) });
      executor.addHook({ getMetadata: () => ({ name: 'Hook2' }) });

      executor.clearHooks();

      expect(executor.getHooks()).toHaveLength(0);
    });
  });

  describe('executeBeforeEvaluation', () => {
    it('should execute hooks in FIFO order', async () => {
      const executionOrder: string[] = [];

      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1' }),
        beforeEvaluation: async () => {
          executionOrder.push('Hook1');
          return { flagKey: 'test' };
        },
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2' }),
        beforeEvaluation: async () => {
          executionOrder.push('Hook2');
          return { flagKey: 'test' };
        },
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      await executor.executeBeforeEvaluation('testFlag');

      expect(executionOrder).toEqual(['Hook1', 'Hook2']);
    });

    it('should collect data from hooks', async () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'DataHook' }),
        beforeEvaluation: async (flagKey) => ({
          flagKey,
          customData: 'test',
        }),
      };

      executor.addHook(hook);

      const dataMap = await executor.executeBeforeEvaluation('testFlag');

      expect(dataMap.get('DataHook')).toEqual({
        flagKey: 'testFlag',
        customData: 'test',
      });
    });

    it('should handle hook errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook' }),
        beforeEvaluation: async () => {
          throw new Error('Hook error');
        },
      };
      const normalHook: Hook = {
        getMetadata: () => ({ name: 'NormalHook' }),
        beforeEvaluation: async () => ({ flagKey: 'test' }),
      };

      executor.addHook(errorHook);
      executor.addHook(normalHook);

      const dataMap = await executor.executeBeforeEvaluation('testFlag');

      expect(consoleSpy).toHaveBeenCalled();
      expect(dataMap.get('NormalHook')).toEqual({ flagKey: 'test' });

      consoleSpy.mockRestore();
    });

    it('should handle hooks without beforeEvaluation', async () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'NoBeforeHook' }),
        afterEvaluation: async () => {},
      };

      executor.addHook(hook);

      const dataMap = await executor.executeBeforeEvaluation('testFlag');

      expect(dataMap.size).toBe(0);
    });
  });

  describe('executeAfterEvaluation', () => {
    it('should execute hooks in LIFO order', async () => {
      const executionOrder: string[] = [];

      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1' }),
        afterEvaluation: async () => {
          executionOrder.push('Hook1');
        },
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2' }),
        afterEvaluation: async () => {
          executionOrder.push('Hook2');
        },
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      await executor.executeAfterEvaluation('testFlag', new Map(), true);

      expect(executionOrder).toEqual(['Hook2', 'Hook1']);
    });

    it('should pass data from beforeEvaluation', async () => {
      const receivedData: any[] = [];

      const hook: Hook = {
        getMetadata: () => ({ name: 'DataHook' }),
        afterEvaluation: async (flagKey, data, result) => {
          receivedData.push({ flagKey, data, result });
        },
      };

      executor.addHook(hook);

      const dataMap = new Map();
      dataMap.set('DataHook', { flagKey: 'test', customData: 'value' });

      await executor.executeAfterEvaluation('testFlag', dataMap, true);

      expect(receivedData[0]).toEqual({
        flagKey: 'testFlag',
        data: { flagKey: 'test', customData: 'value' },
        result: true,
      });
    });

    it('should handle hook errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const errorHook: Hook = {
        getMetadata: () => ({ name: 'ErrorHook' }),
        afterEvaluation: async () => {
          throw new Error('Hook error');
        },
      };

      executor.addHook(errorHook);

      await expect(
        executor.executeAfterEvaluation('testFlag', new Map(), true)
      ).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('executeBeforeIdentify', () => {
    it('should execute hooks in FIFO order', async () => {
      const executionOrder: string[] = [];

      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1' }),
        beforeIdentify: async () => {
          executionOrder.push('Hook1');
          return { identity: 'user' };
        },
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2' }),
        beforeIdentify: async () => {
          executionOrder.push('Hook2');
          return { identity: 'user' };
        },
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      await executor.executeBeforeIdentify('user-123');

      expect(executionOrder).toEqual(['Hook1', 'Hook2']);
    });
  });

  describe('executeAfterIdentify', () => {
    it('should execute hooks in LIFO order', async () => {
      const executionOrder: string[] = [];

      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1' }),
        afterIdentify: async () => {
          executionOrder.push('Hook1');
        },
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2' }),
        afterIdentify: async () => {
          executionOrder.push('Hook2');
        },
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      await executor.executeAfterIdentify('user-123', new Map());

      expect(executionOrder).toEqual(['Hook2', 'Hook1']);
    });
  });

  describe('executeAfterRefresh', () => {
    it('should execute hooks in FIFO order', async () => {
      const executionOrder: string[] = [];

      const hook1: Hook = {
        getMetadata: () => ({ name: 'Hook1' }),
        afterRefresh: async () => {
          executionOrder.push('Hook1');
        },
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'Hook2' }),
        afterRefresh: async () => {
          executionOrder.push('Hook2');
        },
      };

      executor.addHook(hook1);
      executor.addHook(hook2);

      await executor.executeAfterRefresh({ feature1: true });

      expect(executionOrder).toEqual(['Hook1', 'Hook2']);
    });

    it('should pass flags to hooks', async () => {
      const receivedFlags: any[] = [];

      const hook: Hook = {
        getMetadata: () => ({ name: 'FlagsHook' }),
        afterRefresh: async (flags) => {
          receivedFlags.push(flags);
        },
      };

      executor.addHook(hook);

      await executor.executeAfterRefresh({ feature1: true, feature2: false });

      expect(receivedFlags[0]).toEqual({ feature1: true, feature2: false });
    });
  });
});
