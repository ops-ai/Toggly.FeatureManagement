import { HookExecutor } from './hooks';

describe('HookExecutor (direct)', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
    spyOn(console, 'warn');
    spyOn(console, 'error');
  });

  describe('addHook duplicate prevention', () => {
    it('should warn on duplicate hook names', () => {
      executor.addHook({ getMetadata: () => ({ name: 'Dup', version: '1.0.0' }) });
      executor.addHook({ getMetadata: () => ({ name: 'Dup', version: '2.0.0' }) });
      expect(console.warn).toHaveBeenCalledWith(
        jasmine.stringContaining('already registered')
      );
    });
  });

  describe('removeHook', () => {
    it('should return true when hook found', () => {
      executor.addHook({ getMetadata: () => ({ name: 'R1', version: '1.0.0' }) });
      expect(executor.removeHook('R1')).toBe(true);
    });

    it('should return false when hook not found', () => {
      expect(executor.removeHook('NonExistent')).toBe(false);
    });
  });

  describe('executeBeforeEvaluation', () => {
    it('should skip hooks without beforeEvaluation', async () => {
      const calls: string[] = [];
      executor.addHook({ getMetadata: () => ({ name: 'NoBE', version: '1.0.0' }) });
      executor.addHook({
        getMetadata: () => ({ name: 'HasBE', version: '1.0.0' }),
        beforeEvaluation: async (key) => { calls.push(key); },
      });
      await executor.executeBeforeEvaluation('F1');
      expect(calls).toEqual(['F1']);
    });

    it('should catch errors in beforeEvaluation', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'EBE', version: '1.0.0' }),
        beforeEvaluation: async () => { throw new Error('be error'); },
      });
      const dataMap = await executor.executeBeforeEvaluation('F1');
      expect(console.error).toHaveBeenCalledWith(
        jasmine.stringContaining('EBE.beforeEvaluation'),
        jasmine.any(Error)
      );
      expect(dataMap.size).toBe(0);
    });

    it('should collect data from hooks', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'DC', version: '1.0.0' }),
        beforeEvaluation: async (key) => ({ flagKey: key }),
      });
      const dataMap = await executor.executeBeforeEvaluation('F1');
      expect(dataMap.get('DC')).toEqual({ flagKey: 'F1' });
    });
  });

  describe('executeAfterEvaluation', () => {
    it('should catch errors in afterEvaluation', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'EAE', version: '1.0.0' }),
        afterEvaluation: async () => { throw new Error('ae error'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('F1', dataMap, true);
      expect(console.error).toHaveBeenCalledWith(
        jasmine.stringContaining('EAE.afterEvaluation'),
        jasmine.any(Error)
      );
    });

    it('should skip hooks without afterEvaluation', async () => {
      const calls: string[] = [];
      executor.addHook({ getMetadata: () => ({ name: 'NoAE', version: '1.0.0' }) });
      executor.addHook({
        getMetadata: () => ({ name: 'HasAE', version: '1.0.0' }),
        afterEvaluation: async () => { calls.push('called'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('F1', dataMap, true);
      expect(calls).toEqual(['called']);
    });

    it('should execute in LIFO order', async () => {
      const order: string[] = [];
      executor.addHook({
        getMetadata: () => ({ name: 'AE1', version: '1.0.0' }),
        afterEvaluation: async () => { order.push('first'); },
      });
      executor.addHook({
        getMetadata: () => ({ name: 'AE2', version: '1.0.0' }),
        afterEvaluation: async () => { order.push('second'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterEvaluation('F1', dataMap, true);
      expect(order).toEqual(['second', 'first']);
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
      executor.addHook({
        getMetadata: () => ({ name: 'EBI', version: '1.0.0' }),
        beforeIdentify: async () => { throw new Error('bi error'); },
      });
      await executor.executeBeforeIdentify('user-1');
      expect(console.error).toHaveBeenCalledWith(
        jasmine.stringContaining('EBI.beforeIdentify'),
        jasmine.any(Error)
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
      executor.addHook({
        getMetadata: () => ({ name: 'EAI', version: '1.0.0' }),
        afterIdentify: async () => { throw new Error('ai error'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-1', dataMap);
      expect(console.error).toHaveBeenCalledWith(
        jasmine.stringContaining('EAI.afterIdentify'),
        jasmine.any(Error)
      );
    });

    it('should skip hooks without afterIdentify', async () => {
      const calls: string[] = [];
      executor.addHook({ getMetadata: () => ({ name: 'NAI', version: '1.0.0' }) });
      executor.addHook({
        getMetadata: () => ({ name: 'HAI', version: '1.0.0' }),
        afterIdentify: async () => { calls.push('called'); },
      });
      const dataMap = new Map<string, any>();
      await executor.executeAfterIdentify('user-1', dataMap);
      expect(calls).toEqual(['called']);
    });
  });

  describe('executeAfterRefresh', () => {
    it('should execute afterRefresh hooks', async () => {
      let refreshed: any = null;
      executor.addHook({
        getMetadata: () => ({ name: 'AR', version: '1.0.0' }),
        afterRefresh: async (flags) => { refreshed = flags; },
      });
      await executor.executeAfterRefresh({ F1: true });
      expect(refreshed).toEqual({ F1: true });
    });

    it('should catch errors in afterRefresh', async () => {
      executor.addHook({
        getMetadata: () => ({ name: 'ER', version: '1.0.0' }),
        afterRefresh: async () => { throw new Error('refresh error'); },
      });
      await executor.executeAfterRefresh({ F1: true });
      expect(console.error).toHaveBeenCalledWith(
        jasmine.stringContaining('ER.afterRefresh'),
        jasmine.any(Error)
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
