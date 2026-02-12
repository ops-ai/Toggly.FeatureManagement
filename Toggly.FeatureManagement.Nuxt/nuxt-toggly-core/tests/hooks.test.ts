import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HookExecutor } from '../src/hooks'
import type { Hook, EvaluationSeriesData, IdentitySeriesData } from '../src/types'

function createMockHook(name: string, overrides: Partial<Hook> = {}): Hook {
  return {
    getMetadata: () => ({ name }),
    ...overrides,
  }
}

describe('HookExecutor', () => {
  let executor: HookExecutor

  beforeEach(() => {
    executor = new HookExecutor()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('addHook', () => {
    it('should add a hook', () => {
      const hook = createMockHook('test-hook')
      executor.addHook(hook)

      expect(executor.getHooks()).toHaveLength(1)
      expect(executor.getHooks()[0]).toBe(hook)
    })

    it('should warn and skip duplicate hooks', () => {
      const hook1 = createMockHook('test-hook')
      const hook2 = createMockHook('test-hook')

      executor.addHook(hook1)
      executor.addHook(hook2)

      expect(executor.getHooks()).toHaveLength(1)
      expect(console.warn).toHaveBeenCalledWith(
        '[Toggly] Hook with name "test-hook" already exists. Skipping.'
      )
    })

    it('should allow hooks with different names', () => {
      const hook1 = createMockHook('hook-1')
      const hook2 = createMockHook('hook-2')

      executor.addHook(hook1)
      executor.addHook(hook2)

      expect(executor.getHooks()).toHaveLength(2)
    })
  })

  describe('removeHook', () => {
    it('should remove a hook by name', () => {
      const hook = createMockHook('test-hook')
      executor.addHook(hook)

      const result = executor.removeHook('test-hook')

      expect(result).toBe(true)
      expect(executor.getHooks()).toHaveLength(0)
    })

    it('should return false if hook not found', () => {
      const result = executor.removeHook('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('clearHooks', () => {
    it('should remove all hooks', () => {
      executor.addHook(createMockHook('hook-1'))
      executor.addHook(createMockHook('hook-2'))

      executor.clearHooks()

      expect(executor.getHooks()).toHaveLength(0)
    })
  })

  describe('executeBeforeEvaluation', () => {
    it('should execute hooks in FIFO order', async () => {
      const order: string[] = []

      const hook1 = createMockHook('hook-1', {
        beforeEvaluation: async () => {
          order.push('hook-1')
          return { data: 1 }
        },
      })

      const hook2 = createMockHook('hook-2', {
        beforeEvaluation: async () => {
          order.push('hook-2')
          return { data: 2 }
        },
      })

      executor.addHook(hook1)
      executor.addHook(hook2)

      await executor.executeBeforeEvaluation('flag-key')

      expect(order).toEqual(['hook-1', 'hook-2'])
    })

    it('should return data map from hooks', async () => {
      const hook = createMockHook('test-hook', {
        beforeEvaluation: async () => ({ custom: 'data' }),
      })

      executor.addHook(hook)

      const dataMap = await executor.executeBeforeEvaluation('flag-key')

      expect(dataMap.get('test-hook')).toEqual({ custom: 'data' })
    })

    it('should handle hook errors gracefully', async () => {
      const hook = createMockHook('error-hook', {
        beforeEvaluation: async () => {
          throw new Error('Hook error')
        },
      })

      executor.addHook(hook)

      const dataMap = await executor.executeBeforeEvaluation('flag-key')

      expect(dataMap.get('error-hook')).toBeUndefined()
      expect(console.error).toHaveBeenCalled()
    })

    it('should pass flagKey and defaultValue to hooks', async () => {
      const beforeEvaluation = vi.fn()
      const hook = createMockHook('test-hook', { beforeEvaluation })

      executor.addHook(hook)

      await executor.executeBeforeEvaluation('my-flag', true)

      expect(beforeEvaluation).toHaveBeenCalledWith('my-flag', true)
    })
  })

  describe('executeAfterEvaluation', () => {
    it('should execute hooks in LIFO order', async () => {
      const order: string[] = []

      const hook1 = createMockHook('hook-1', {
        afterEvaluation: async () => {
          order.push('hook-1')
        },
      })

      const hook2 = createMockHook('hook-2', {
        afterEvaluation: async () => {
          order.push('hook-2')
        },
      })

      executor.addHook(hook1)
      executor.addHook(hook2)

      await executor.executeAfterEvaluation(
        'flag-key',
        new Map<string, EvaluationSeriesData | void>(),
        true
      )

      expect(order).toEqual(['hook-2', 'hook-1'])
    })

    it('should pass data from beforeEvaluation', async () => {
      const afterEvaluation = vi.fn()
      const hook = createMockHook('test-hook', { afterEvaluation })

      executor.addHook(hook)

      const dataMap = new Map<string, EvaluationSeriesData | void>()
      dataMap.set('test-hook', { custom: 'data' })

      await executor.executeAfterEvaluation('flag-key', dataMap, true)

      expect(afterEvaluation).toHaveBeenCalledWith(
        'flag-key',
        { custom: 'data' },
        true
      )
    })

    it('should handle hook errors gracefully', async () => {
      const hook = createMockHook('error-hook', {
        afterEvaluation: async () => {
          throw new Error('Hook error')
        },
      })

      executor.addHook(hook)

      await expect(
        executor.executeAfterEvaluation(
          'flag-key',
          new Map<string, EvaluationSeriesData | void>(),
          true
        )
      ).resolves.not.toThrow()

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('executeBeforeIdentify', () => {
    it('should execute hooks in FIFO order', async () => {
      const order: string[] = []

      const hook1 = createMockHook('hook-1', {
        beforeIdentify: async () => {
          order.push('hook-1')
        },
      })

      const hook2 = createMockHook('hook-2', {
        beforeIdentify: async () => {
          order.push('hook-2')
        },
      })

      executor.addHook(hook1)
      executor.addHook(hook2)

      await executor.executeBeforeIdentify('user-123')

      expect(order).toEqual(['hook-1', 'hook-2'])
    })

    it('should handle hook errors gracefully', async () => {
      const hook = createMockHook('error-hook', {
        beforeIdentify: async () => {
          throw new Error('Hook error')
        },
      })

      executor.addHook(hook)

      const dataMap = await executor.executeBeforeIdentify('user-123')

      expect(dataMap.get('error-hook')).toBeUndefined()
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('executeAfterIdentify', () => {
    it('should execute hooks in LIFO order', async () => {
      const order: string[] = []

      const hook1 = createMockHook('hook-1', {
        afterIdentify: async () => {
          order.push('hook-1')
        },
      })

      const hook2 = createMockHook('hook-2', {
        afterIdentify: async () => {
          order.push('hook-2')
        },
      })

      executor.addHook(hook1)
      executor.addHook(hook2)

      await executor.executeAfterIdentify(
        'user-123',
        new Map<string, IdentitySeriesData | void>()
      )

      expect(order).toEqual(['hook-2', 'hook-1'])
    })

    it('should handle hook errors gracefully', async () => {
      const hook = createMockHook('error-hook', {
        afterIdentify: async () => {
          throw new Error('Hook error')
        },
      })

      executor.addHook(hook)

      await expect(
        executor.executeAfterIdentify(
          'user-123',
          new Map<string, IdentitySeriesData | void>()
        )
      ).resolves.not.toThrow()

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('executeAfterRefresh', () => {
    it('should execute all hooks', async () => {
      const afterRefresh1 = vi.fn()
      const afterRefresh2 = vi.fn()

      executor.addHook(createMockHook('hook-1', { afterRefresh: afterRefresh1 }))
      executor.addHook(createMockHook('hook-2', { afterRefresh: afterRefresh2 }))

      const flags = { 'feature-a': true, 'feature-b': false }
      await executor.executeAfterRefresh(flags)

      expect(afterRefresh1).toHaveBeenCalledWith(flags)
      expect(afterRefresh2).toHaveBeenCalledWith(flags)
    })

    it('should handle hook errors gracefully', async () => {
      const hook = createMockHook('error-hook', {
        afterRefresh: async () => {
          throw new Error('Hook error')
        },
      })

      executor.addHook(hook)

      await expect(
        executor.executeAfterRefresh({ 'feature-a': true })
      ).resolves.not.toThrow()

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('hooks without methods', () => {
    it('should skip hooks without beforeEvaluation', async () => {
      const hook = createMockHook('test-hook')
      executor.addHook(hook)

      const dataMap = await executor.executeBeforeEvaluation('flag-key')

      expect(dataMap.size).toBe(0)
    })

    it('should skip hooks without afterEvaluation', async () => {
      const hook = createMockHook('test-hook')
      executor.addHook(hook)

      await expect(
        executor.executeAfterEvaluation(
          'flag-key',
          new Map<string, EvaluationSeriesData | void>(),
          true
        )
      ).resolves.not.toThrow()
    })
  })
})
