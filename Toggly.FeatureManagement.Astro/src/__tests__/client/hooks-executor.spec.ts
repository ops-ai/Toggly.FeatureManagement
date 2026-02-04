import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookExecutor } from '../../client/hooks.js';
import type { Hook } from '@ops-ai/toggly-hooks-types';

function createMockHook(name: string, overrides?: Partial<Hook>): Hook {
  return {
    getMetadata: () => ({ name, version: '1.0.0' }),
    ...overrides,
  };
}

describe('HookExecutor', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
  });

  describe('addHook', () => {
    it('should register a hook', () => {
      const hook = createMockHook('TestHook', {
        afterRefresh: vi.fn(),
      });
      executor.addHook(hook);
      // No error thrown
    });

    it('should skip duplicate hook names and log warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const hook1 = createMockHook('SameName');
      const hook2 = createMockHook('SameName');

      executor.addHook(hook1);
      executor.addHook(hook2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );

      warnSpy.mockRestore();
    });

    it('should allow hooks with different names', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      executor.addHook(createMockHook('Hook1'));
      executor.addHook(createMockHook('Hook2'));

      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('removeHook', () => {
    it('should remove a hook by name and return true', () => {
      executor.addHook(createMockHook('TestHook'));
      const result = executor.removeHook('TestHook');
      expect(result).toBe(true);
    });

    it('should return false when hook name not found', () => {
      const result = executor.removeHook('NonExistent');
      expect(result).toBe(false);
    });

    it('should not call removed hook on subsequent executions', async () => {
      const callback = vi.fn();
      executor.addHook(
        createMockHook('TestHook', { afterRefresh: callback })
      );

      executor.removeHook('TestHook');
      await executor.executeAfterRefresh({ F1: true });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('executeBeforeEvaluation', () => {
    it('should call beforeEvaluation hooks in FIFO order', async () => {
      const order: string[] = [];

      executor.addHook(
        createMockHook('Hook1', {
          beforeEvaluation: async () => {
            order.push('hook1');
            return { startTime: 1 };
          },
        })
      );
      executor.addHook(
        createMockHook('Hook2', {
          beforeEvaluation: async () => {
            order.push('hook2');
            return { startTime: 2 };
          },
        })
      );

      const dataMap = await executor.executeBeforeEvaluation('myFlag', true);

      expect(order).toEqual(['hook1', 'hook2']);
      expect(dataMap.get('Hook1')).toEqual({ startTime: 1 });
      expect(dataMap.get('Hook2')).toEqual({ startTime: 2 });
    });

    it('should pass flagKey and defaultValue', async () => {
      const beforeEval = vi.fn().mockResolvedValue(undefined);
      executor.addHook(createMockHook('TestHook', { beforeEvaluation: beforeEval }));

      await executor.executeBeforeEvaluation('myFlag', false);

      expect(beforeEval).toHaveBeenCalledWith('myFlag', false);
    });

    it('should isolate errors between hooks', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const callback = vi.fn().mockResolvedValue({ data: 'ok' });

      executor.addHook(
        createMockHook('ErrorHook', {
          beforeEvaluation: async () => {
            throw new Error('Hook failed');
          },
        })
      );
      executor.addHook(
        createMockHook('GoodHook', { beforeEvaluation: callback })
      );

      const dataMap = await executor.executeBeforeEvaluation('flag');

      expect(callback).toHaveBeenCalled();
      expect(dataMap.get('GoodHook')).toEqual({ data: 'ok' });
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should skip hooks without beforeEvaluation', async () => {
      executor.addHook(createMockHook('NoBeforeEval'));

      const dataMap = await executor.executeBeforeEvaluation('flag');
      expect(dataMap.size).toBe(0);
    });
  });

  describe('executeAfterEvaluation', () => {
    it('should call afterEvaluation hooks in LIFO (reverse) order', async () => {
      const order: string[] = [];

      executor.addHook(
        createMockHook('Hook1', {
          afterEvaluation: async () => {
            order.push('hook1');
          },
        })
      );
      executor.addHook(
        createMockHook('Hook2', {
          afterEvaluation: async () => {
            order.push('hook2');
          },
        })
      );

      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('myFlag', dataMap, true);

      expect(order).toEqual(['hook2', 'hook1']); // Reverse order
    });

    it('should pass data from beforeEvaluation and result', async () => {
      const afterEval = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('TestHook', { afterEvaluation: afterEval })
      );

      const dataMap = new Map<string, any>();
      dataMap.set('TestHook', { startTime: 123 });

      await executor.executeAfterEvaluation('myFlag', dataMap, true);

      expect(afterEval).toHaveBeenCalledWith('myFlag', { startTime: 123 }, true);
    });

    it('should isolate errors between hooks', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodCallback = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('GoodHook', { afterEvaluation: goodCallback })
      );
      executor.addHook(
        createMockHook('ErrorHook', {
          afterEvaluation: async () => {
            throw new Error('Hook failed');
          },
        })
      );

      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('flag', dataMap, true);

      // GoodHook should still execute (it comes after ErrorHook in reverse)
      expect(goodCallback).toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });

  describe('executeBeforeIdentify', () => {
    it('should call beforeIdentify hooks in FIFO order', async () => {
      const order: string[] = [];

      executor.addHook(
        createMockHook('Hook1', {
          beforeIdentify: async () => {
            order.push('hook1');
            return { userId: 'captured' };
          },
        })
      );
      executor.addHook(
        createMockHook('Hook2', {
          beforeIdentify: async () => {
            order.push('hook2');
          },
        })
      );

      const dataMap = await executor.executeBeforeIdentify('user-123');

      expect(order).toEqual(['hook1', 'hook2']);
      expect(dataMap.get('Hook1')).toEqual({ userId: 'captured' });
    });

    it('should pass identity to hooks', async () => {
      const beforeId = vi.fn().mockResolvedValue(undefined);
      executor.addHook(
        createMockHook('TestHook', { beforeIdentify: beforeId })
      );

      await executor.executeBeforeIdentify('user-456');

      expect(beforeId).toHaveBeenCalledWith('user-456');
    });

    it('should isolate errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodCallback = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('ErrorHook', {
          beforeIdentify: async () => {
            throw new Error('fail');
          },
        })
      );
      executor.addHook(
        createMockHook('GoodHook', { beforeIdentify: goodCallback })
      );

      await executor.executeBeforeIdentify('user');

      expect(goodCallback).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('executeAfterIdentify', () => {
    it('should call afterIdentify hooks in LIFO (reverse) order', async () => {
      const order: string[] = [];

      executor.addHook(
        createMockHook('Hook1', {
          afterIdentify: async () => {
            order.push('hook1');
          },
        })
      );
      executor.addHook(
        createMockHook('Hook2', {
          afterIdentify: async () => {
            order.push('hook2');
          },
        })
      );

      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-123', dataMap);

      expect(order).toEqual(['hook2', 'hook1']); // Reverse
    });

    it('should pass identity and data from beforeIdentify', async () => {
      const afterId = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('TestHook', { afterIdentify: afterId })
      );

      const dataMap = new Map<string, any>();
      dataMap.set('TestHook', { userId: 'captured' });

      await executor.executeAfterIdentify('user-123', dataMap);

      expect(afterId).toHaveBeenCalledWith('user-123', { userId: 'captured' });
    });

    it('should isolate errors', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodCallback = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('GoodHook', { afterIdentify: goodCallback })
      );
      executor.addHook(
        createMockHook('ErrorHook', {
          afterIdentify: async () => {
            throw new Error('fail');
          },
        })
      );

      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user', dataMap);

      expect(goodCallback).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('executeAfterRefresh', () => {
    it('should call afterRefresh hooks in FIFO order', async () => {
      const order: string[] = [];

      executor.addHook(
        createMockHook('Hook1', {
          afterRefresh: async () => {
            order.push('hook1');
          },
        })
      );
      executor.addHook(
        createMockHook('Hook2', {
          afterRefresh: async () => {
            order.push('hook2');
          },
        })
      );

      await executor.executeAfterRefresh({ F1: true });

      expect(order).toEqual(['hook1', 'hook2']); // FIFO
    });

    it('should pass flags to afterRefresh', async () => {
      const afterRefresh = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('TestHook', { afterRefresh })
      );

      await executor.executeAfterRefresh({ Feature1: true, Feature2: false });

      expect(afterRefresh).toHaveBeenCalledWith({
        Feature1: true,
        Feature2: false,
      });
    });

    it('should isolate errors between hooks', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const goodCallback = vi.fn().mockResolvedValue(undefined);

      executor.addHook(
        createMockHook('ErrorHook', {
          afterRefresh: async () => {
            throw new Error('fail');
          },
        })
      );
      executor.addHook(
        createMockHook('GoodHook', { afterRefresh: goodCallback })
      );

      await executor.executeAfterRefresh({ F1: true });

      expect(goodCallback).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('should skip hooks without afterRefresh', async () => {
      executor.addHook(createMockHook('NoAfterRefresh'));

      // Should not throw
      await executor.executeAfterRefresh({ F1: true });
    });
  });
});
