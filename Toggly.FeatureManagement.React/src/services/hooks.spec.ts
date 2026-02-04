import type { Hook } from '@ops-ai/toggly-hooks-types';
import { HookExecutor } from './hooks';

describe('HookExecutor', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addHook', () => {
    it('should add a hook', async () => {
      const calls: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'H1', version: '1.0.0' }),
        beforeEvaluation: async (key) => {
          calls.push(key);
        },
      });

      await executor.executeBeforeEvaluation('F1');
      expect(calls).toEqual(['F1']);
    });

    it('should prevent duplicate hook registration', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      executor.addHook({
        getMetadata: () => ({ name: 'Dup', version: '1.0.0' }),
      });
      executor.addHook({
        getMetadata: () => ({ name: 'Dup', version: '2.0.0' }),
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );
    });
  });

  describe('removeHook', () => {
    it('should remove existing hook and return true', () => {
      executor.addHook({
        getMetadata: () => ({ name: 'R1', version: '1.0.0' }),
      });

      expect(executor.removeHook('R1')).toBe(true);
    });

    it('should return false for non-existent hook', () => {
      expect(executor.removeHook('NonExistent')).toBe(false);
    });
  });

  describe('executeBeforeEvaluation', () => {
    it('should execute beforeEvaluation hooks in FIFO order', async () => {
      const order: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'First', version: '1.0.0' }),
        beforeEvaluation: async () => {
          order.push('first');
        },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'Second', version: '1.0.0' }),
        beforeEvaluation: async () => {
          order.push('second');
        },
      });

      await executor.executeBeforeEvaluation('F1');
      expect(order).toEqual(['first', 'second']);
    });

    it('should return data map from hooks', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'DataHook', version: '1.0.0' }),
        beforeEvaluation: async (key) => ({ flagKey: key }),
      });

      const dataMap = await executor.executeBeforeEvaluation('F1');
      expect(dataMap.get('DataHook')).toEqual({ flagKey: 'F1' });
    });

    it('should catch errors in individual hooks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      executor.addHook({
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        beforeEvaluation: async () => {
          throw new Error('Hook error');
        },
      });

      const dataMap = await executor.executeBeforeEvaluation('F1');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrorHook.beforeEvaluation'),
        expect.any(Error)
      );
      expect(dataMap.size).toBe(0); // Error hook data not stored
    });

    it('should skip hooks without beforeEvaluation', async () => {
      const calls: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'NoBeforeHook', version: '1.0.0' }),
        // No beforeEvaluation
      });
      executor.addHook({
        getMetadata: () => ({ name: 'WithBeforeHook', version: '1.0.0' }),
        beforeEvaluation: async () => {
          calls.push('called');
        },
      });

      await executor.executeBeforeEvaluation('F1');
      expect(calls).toEqual(['called']);
    });
  });

  describe('executeAfterEvaluation', () => {
    it('should execute afterEvaluation hooks in LIFO order', async () => {
      const order: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'First', version: '1.0.0' }),
        afterEvaluation: async () => {
          order.push('first');
        },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'Second', version: '1.0.0' }),
        afterEvaluation: async () => {
          order.push('second');
        },
      });

      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('F1', dataMap, true);
      expect(order).toEqual(['second', 'first']); // LIFO
    });

    it('should pass data from dataMap to hooks', async () => {
      let receivedData: any = null;

      executor.addHook({
        getMetadata: () => ({ name: 'DataHook', version: '1.0.0' }),
        afterEvaluation: async (_key, data) => {
          receivedData = data;
        },
      });

      const dataMap = new Map<string, any>([['DataHook', { flagKey: 'F1', extra: 'value' }]]);
      await executor.executeAfterEvaluation('F1', dataMap, true);
      expect(receivedData).toEqual({ flagKey: 'F1', extra: 'value' });
    });

    it('should catch errors in afterEvaluation hooks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      executor.addHook({
        getMetadata: () => ({ name: 'ErrAfterEval', version: '1.0.0' }),
        afterEvaluation: async () => {
          throw new Error('after eval error');
        },
      });

      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('F1', dataMap, true);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrAfterEval.afterEvaluation'),
        expect.any(Error)
      );
    });
  });

  describe('executeBeforeIdentify', () => {
    it('should execute beforeIdentify hooks in FIFO order', async () => {
      const order: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'Id1', version: '1.0.0' }),
        beforeIdentify: async () => {
          order.push('first');
        },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'Id2', version: '1.0.0' }),
        beforeIdentify: async () => {
          order.push('second');
        },
      });

      await executor.executeBeforeIdentify('user-1');
      expect(order).toEqual(['first', 'second']);
    });

    it('should return data map', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'IdHook', version: '1.0.0' }),
        beforeIdentify: async (identity) => ({ identity }),
      });

      const dataMap = await executor.executeBeforeIdentify('user-1');
      expect(dataMap.get('IdHook')).toEqual({ identity: 'user-1' });
    });

    it('should catch errors in beforeIdentify hooks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      executor.addHook({
        getMetadata: () => ({ name: 'ErrIdHook', version: '1.0.0' }),
        beforeIdentify: async () => {
          throw new Error('id error');
        },
      });

      await executor.executeBeforeIdentify('user-1');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrIdHook.beforeIdentify'),
        expect.any(Error)
      );
    });

    it('should skip hooks without beforeIdentify', async () => {
      const calls: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'NoIdHook', version: '1.0.0' }),
      });
      executor.addHook({
        getMetadata: () => ({ name: 'HasIdHook', version: '1.0.0' }),
        beforeIdentify: async () => {
          calls.push('called');
        },
      });

      await executor.executeBeforeIdentify('user-1');
      expect(calls).toEqual(['called']);
    });
  });

  describe('executeAfterIdentify', () => {
    it('should execute afterIdentify hooks in LIFO order', async () => {
      const order: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'AId1', version: '1.0.0' }),
        afterIdentify: async () => {
          order.push('first');
        },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'AId2', version: '1.0.0' }),
        afterIdentify: async () => {
          order.push('second');
        },
      });

      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-1', dataMap);
      expect(order).toEqual(['second', 'first']); // LIFO
    });

    it('should catch errors in afterIdentify hooks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      executor.addHook({
        getMetadata: () => ({ name: 'ErrAfterId', version: '1.0.0' }),
        afterIdentify: async () => {
          throw new Error('after id error');
        },
      });

      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-1', dataMap);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrAfterId.afterIdentify'),
        expect.any(Error)
      );
    });
  });

  describe('executeAfterRefresh', () => {
    it('should execute afterRefresh hooks', async () => {
      let refreshedFlags: any = null;

      executor.addHook({
        getMetadata: () => ({ name: 'RefHook', version: '1.0.0' }),
        afterRefresh: async (flags) => {
          refreshedFlags = flags;
        },
      });

      await executor.executeAfterRefresh({ F1: true });
      expect(refreshedFlags).toEqual({ F1: true });
    });

    it('should catch errors in afterRefresh hooks', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      executor.addHook({
        getMetadata: () => ({ name: 'ErrRefresh', version: '1.0.0' }),
        afterRefresh: async () => {
          throw new Error('refresh error');
        },
      });

      await executor.executeAfterRefresh({ F1: true });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrRefresh.afterRefresh'),
        expect.any(Error)
      );
    });

    it('should skip hooks without afterRefresh', async () => {
      const calls: string[] = [];

      executor.addHook({
        getMetadata: () => ({ name: 'NoRefresh', version: '1.0.0' }),
      });
      executor.addHook({
        getMetadata: () => ({ name: 'HasRefresh', version: '1.0.0' }),
        afterRefresh: async () => {
          calls.push('called');
        },
      });

      await executor.executeAfterRefresh({ F1: true });
      expect(calls).toEqual(['called']);
    });
  });
});
