import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Hook } from '@ops-ai/toggly-hooks-types';
import { HookExecutor } from '../services/hooks';

describe('HookExecutor', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
  });

  // ─── Registration ──────────────────────
  describe('addHook', () => {
    it('should add a hook', () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'TestHook', version: '1.0.0' }),
      };
      executor.addHook(hook);
      // Verify by trying to add same name again
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      executor.addHook(hook);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('already registered')
      );
    });

    it('should reject duplicate hook names', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const hook1: Hook = {
        getMetadata: () => ({ name: 'DupHook', version: '1.0.0' }),
      };
      const hook2: Hook = {
        getMetadata: () => ({ name: 'DupHook', version: '2.0.0' }),
      };
      executor.addHook(hook1);
      executor.addHook(hook2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"DupHook" already registered')
      );
    });
  });

  // ─── removeHook ──────────────────────
  describe('removeHook', () => {
    it('should remove existing hook', () => {
      executor.addHook({
        getMetadata: () => ({ name: 'ToRemove', version: '1.0.0' }),
      });
      expect(executor.removeHook('ToRemove')).toBe(true);
    });

    it('should return false for non-existent hook', () => {
      expect(executor.removeHook('NonExistent')).toBe(false);
    });
  });

  // ─── beforeEvaluation ──────────────────────
  describe('executeBeforeEvaluation', () => {
    it('should execute hooks in FIFO order', async () => {
      const order: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'H1', version: '1.0.0' }),
        beforeEvaluation: async () => { order.push('H1'); },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'H2', version: '1.0.0' }),
        beforeEvaluation: async () => { order.push('H2'); },
      });
      await executor.executeBeforeEvaluation('flag1');
      expect(order).toEqual(['H1', 'H2']);
    });

    it('should collect data from hooks', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'DataHook', version: '1.0.0' }),
        beforeEvaluation: async (flagKey, defaultValue) => ({
          flagKey,
          defaultValue,
        }),
      });
      const dataMap = await executor.executeBeforeEvaluation('flag1', true);
      expect(dataMap.get('DataHook')).toEqual({ flagKey: 'flag1', defaultValue: true });
    });

    it('should skip hooks without beforeEvaluation', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'NoBeforeHook', version: '1.0.0' }),
      });
      const dataMap = await executor.executeBeforeEvaluation('flag1');
      expect(dataMap.size).toBe(0);
    });

    it('should handle errors without failing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'ErrorHook', version: '1.0.0' }),
        beforeEvaluation: async () => { throw new Error('fail'); },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'GoodHook', version: '1.0.0' }),
        beforeEvaluation: async () => ({ flagKey: 'flag1' }),
      });
      const dataMap = await executor.executeBeforeEvaluation('flag1');
      expect(dataMap.get('GoodHook')).toBeTruthy();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrorHook.beforeEvaluation'),
        expect.any(Error)
      );
    });
  });

  // ─── afterEvaluation ──────────────────────
  describe('executeAfterEvaluation', () => {
    it('should execute hooks in LIFO order', async () => {
      const order: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'H1', version: '1.0.0' }),
        afterEvaluation: async () => { order.push('H1'); },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'H2', version: '1.0.0' }),
        afterEvaluation: async () => { order.push('H2'); },
      });
      await executor.executeAfterEvaluation('flag1', new Map(), true);
      expect(order).toEqual(['H2', 'H1']);
    });

    it('should pass data from beforeEvaluation', async () => {
      let receivedData: any;
      executor.addHook({
        getMetadata: () => ({ name: 'DataHook', version: '1.0.0' }),
        afterEvaluation: async (flagKey, data, result) => {
          receivedData = { flagKey, data, result };
        },
      });
      const dataMap = new Map<string, any>();
      dataMap.set('DataHook', { flagKey: 'flag1' });
      await executor.executeAfterEvaluation('flag1', dataMap, true);
      expect(receivedData).toEqual({
        flagKey: 'flag1',
        data: { flagKey: 'flag1' },
        result: true,
      });
    });

    it('should skip hooks without afterEvaluation', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'NoAfterHook', version: '1.0.0' }),
      });
      // Should not throw
      await executor.executeAfterEvaluation('flag1', new Map(), true);
    });

    it('should handle errors without failing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'ErrorAfterHook', version: '1.0.0' }),
        afterEvaluation: async () => { throw new Error('fail'); },
      });
      await executor.executeAfterEvaluation('flag1', new Map(), true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ErrorAfterHook.afterEvaluation'),
        expect.any(Error)
      );
    });
  });

  // ─── beforeIdentify ──────────────────────
  describe('executeBeforeIdentify', () => {
    it('should execute and collect identity data', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'IdHook', version: '1.0.0' }),
        beforeIdentify: async (identity) => ({ identity }),
      });
      const dataMap = await executor.executeBeforeIdentify('user-123');
      expect(dataMap.get('IdHook')).toEqual({ identity: 'user-123' });
    });

    it('should skip hooks without beforeIdentify', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'NoIdHook', version: '1.0.0' }),
      });
      const dataMap = await executor.executeBeforeIdentify('user-123');
      expect(dataMap.size).toBe(0);
    });

    it('should handle errors without failing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'ErrorIdHook', version: '1.0.0' }),
        beforeIdentify: async () => { throw new Error('fail'); },
      });
      const dataMap = await executor.executeBeforeIdentify('user-123');
      expect(dataMap.size).toBe(0);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ─── afterIdentify ──────────────────────
  describe('executeAfterIdentify', () => {
    it('should execute in LIFO order', async () => {
      const order: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'Id1', version: '1.0.0' }),
        afterIdentify: async () => { order.push('Id1'); },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'Id2', version: '1.0.0' }),
        afterIdentify: async () => { order.push('Id2'); },
      });
      await executor.executeAfterIdentify('user-123', new Map());
      expect(order).toEqual(['Id2', 'Id1']);
    });

    it('should skip hooks without afterIdentify', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'NoAfterIdHook', version: '1.0.0' }),
      });
      // Should not throw
      await executor.executeAfterIdentify('user-123', new Map());
    });

    it('should handle errors without failing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'ErrorAfterIdHook', version: '1.0.0' }),
        afterIdentify: async () => { throw new Error('fail'); },
      });
      await executor.executeAfterIdentify('user-123', new Map());
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ─── afterRefresh ──────────────────────
  describe('executeAfterRefresh', () => {
    it('should execute refresh hooks', async () => {
      let refreshed = false;
      executor.addHook({
        getMetadata: () => ({ name: 'RefreshHook', version: '1.0.0' }),
        afterRefresh: async () => { refreshed = true; },
      });
      await executor.executeAfterRefresh({ F1: true });
      expect(refreshed).toBe(true);
    });

    it('should skip hooks without afterRefresh', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'NoRefreshHook', version: '1.0.0' }),
      });
      // Should not throw
      await executor.executeAfterRefresh({ F1: true });
    });

    it('should handle errors without failing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      executor.addHook({
        getMetadata: () => ({ name: 'ErrorRefreshHook', version: '1.0.0' }),
        afterRefresh: async () => { throw new Error('fail'); },
      });
      await executor.executeAfterRefresh({ F1: true });
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
