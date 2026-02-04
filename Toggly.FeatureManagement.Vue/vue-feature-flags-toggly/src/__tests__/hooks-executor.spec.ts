import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HookExecutor } from '../plugins/hooks';
import type { Hook } from '@ops-ai/toggly-hooks-types';

describe('HookExecutor (direct)', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addHook duplicate prevention', () => {
    it('should warn on duplicate hook names', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      executor.addHook({ getMetadata: () => ({ name: 'Dup', version: '1.0.0' }) });
      executor.addHook({ getMetadata: () => ({ name: 'Dup', version: '2.0.0' }) });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
    });
  });

  describe('executeAfterEvaluation error', () => {
    it('should catch errors in afterEvaluation hooks', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'AE', version: '1.0.0' }),
        afterEvaluation: async () => { throw new Error('ae error'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('F1', dataMap, true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('AE.afterEvaluation'),
        expect.any(Error)
      );
    });
  });

  describe('executeBeforeIdentify', () => {
    it('should execute beforeIdentify hooks', async () => {
      const calls: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'BI', version: '1.0.0' }),
        beforeIdentify: async (identity) => { calls.push(identity); return { identity }; },
      });
      const dataMap = await executor.executeBeforeIdentify('user-1');
      expect(calls).toEqual(['user-1']);
      expect(dataMap.get('BI')).toEqual({ identity: 'user-1' });
    });

    it('should catch errors in beforeIdentify', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'EBI', version: '1.0.0' }),
        beforeIdentify: async () => { throw new Error('bi error'); },
      });
      await executor.executeBeforeIdentify('user-1');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('EBI.beforeIdentify'),
        expect.any(Error)
      );
    });

    it('should skip hooks without beforeIdentify', async () => {
      const calls: string[] = [];
      executor.addHook({ getMetadata: () => ({ name: 'NBI', version: '1.0.0' }) });
      executor.addHook({
        getMetadata: () => ({ name: 'HBI', version: '1.0.0' }),
        beforeIdentify: async () => { calls.push('called'); },
      });
      await executor.executeBeforeIdentify('user-1');
      expect(calls).toEqual(['called']);
    });
  });

  describe('executeAfterIdentify', () => {
    it('should execute afterIdentify in LIFO', async () => {
      const order: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'AI1', version: '1.0.0' }),
        afterIdentify: async () => { order.push('first'); },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'AI2', version: '1.0.0' }),
        afterIdentify: async () => { order.push('second'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-1', dataMap);
      expect(order).toEqual(['second', 'first']);
    });

    it('should catch errors in afterIdentify', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'EAI', version: '1.0.0' }),
        afterIdentify: async () => { throw new Error('ai error'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-1', dataMap);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('EAI.afterIdentify'),
        expect.any(Error)
      );
    });
  });

  describe('executeAfterRefresh error', () => {
    it('should catch errors in afterRefresh', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'ER', version: '1.0.0' }),
        afterRefresh: async () => { throw new Error('refresh error'); },
      });
      await executor.executeAfterRefresh({ F1: true });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ER.afterRefresh'),
        expect.any(Error)
      );
    });

    it('should skip hooks without afterRefresh', async () => {
      const calls: string[] = [];
      executor.addHook({ getMetadata: () => ({ name: 'NR', version: '1.0.0' }) });
      executor.addHook({
        getMetadata: () => ({ name: 'HR', version: '1.0.0' }),
        afterRefresh: async () => { calls.push('called'); },
      });
      await executor.executeAfterRefresh({ F1: true });
      expect(calls).toEqual(['called']);
    });
  });
});
