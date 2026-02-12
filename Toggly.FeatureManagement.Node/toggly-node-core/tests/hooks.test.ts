import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HookExecutor, createLoggingHook } from '../src/hooks'
import type { Hook, EvaluationContext } from '../src/types'

describe('HookExecutor', () => {
  let executor: HookExecutor

  beforeEach(() => {
    executor = new HookExecutor(false)
  })

  afterEach(() => {
    executor.clear()
  })

  describe('addHook', () => {
    it('should add a hook', () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
      }

      executor.addHook(hook)

      expect(executor.getHooks()).toHaveLength(1)
      expect(executor.getHookMetadata()).toEqual([{ name: 'test-hook' }])
    })

    it('should not add duplicate hooks', () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'test-hook' }),
      }

      executor.addHook(hook)
      executor.addHook(hook)

      expect(executor.getHooks()).toHaveLength(1)
    })

    it('should add multiple different hooks', () => {
      const hook1: Hook = { getMetadata: () => ({ name: 'hook-1' }) }
      const hook2: Hook = { getMetadata: () => ({ name: 'hook-2' }) }

      executor.addHook(hook1)
      executor.addHook(hook2)

      expect(executor.getHooks()).toHaveLength(2)
    })
  })

  describe('removeHook', () => {
    it('should remove a hook by name', () => {
      const hook: Hook = { getMetadata: () => ({ name: 'test-hook' }) }
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

  describe('executeBeforeEvaluation', () => {
    it('should execute hooks in FIFO order', async () => {
      const order: string[] = []

      const hook1: Hook = {
        getMetadata: () => ({ name: 'hook-1' }),
        beforeEvaluation: async () => {
          order.push('hook-1')
          return { hook: 1 }
        },
      }

      const hook2: Hook = {
        getMetadata: () => ({ name: 'hook-2' }),
        beforeEvaluation: async () => {
          order.push('hook-2')
          return { hook: 2 }
        },
      }

      executor.addHook(hook1)
      executor.addHook(hook2)

      const context: EvaluationContext = { identity: 'user-123' }
      await executor.executeBeforeEvaluation('my-feature', context)

      expect(order).toEqual(['hook-1', 'hook-2'])
    })

    it('should collect data from hooks', async () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'data-hook' }),
        beforeEvaluation: async () => ({ myData: 'value' }),
      }

      executor.addHook(hook)

      const context: EvaluationContext = {}
      const results = await executor.executeBeforeEvaluation('feature', context)

      expect(results).toEqual([
        { hook: 'data-hook', data: { myData: 'value' } },
      ])
    })

    it('should handle hook errors gracefully', async () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'error-hook' }),
        beforeEvaluation: async () => {
          throw new Error('Hook error')
        },
      }

      executor.addHook(hook)

      const context: EvaluationContext = {}
      // Should not throw
      const results = await executor.executeBeforeEvaluation('feature', context)
      expect(results).toEqual([])
    })
  })

  describe('executeAfterEvaluation', () => {
    it('should execute hooks in LIFO order', async () => {
      const order: string[] = []

      const hook1: Hook = {
        getMetadata: () => ({ name: 'hook-1' }),
        afterEvaluation: async () => {
          order.push('hook-1')
        },
      }

      const hook2: Hook = {
        getMetadata: () => ({ name: 'hook-2' }),
        afterEvaluation: async () => {
          order.push('hook-2')
        },
      }

      executor.addHook(hook1)
      executor.addHook(hook2)

      const context: EvaluationContext = {}
      await executor.executeAfterEvaluation('feature', context, [], true)

      expect(order).toEqual(['hook-2', 'hook-1'])
    })

    it('should pass hook data to after hooks', async () => {
      const receivedData = vi.fn()

      const hook: Hook = {
        getMetadata: () => ({ name: 'data-hook' }),
        afterEvaluation: async (_key, _ctx, data, result) => {
          receivedData(data, result)
        },
      }

      executor.addHook(hook)

      const hookData = [{ hook: 'data-hook', data: { testData: true } }]
      const context: EvaluationContext = {}
      await executor.executeAfterEvaluation('feature', context, hookData, true)

      expect(receivedData).toHaveBeenCalledWith({ testData: true }, true)
    })
  })

  describe('executeBeforeIdentify', () => {
    it('should execute hooks and collect data', async () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'identify-hook' }),
        beforeIdentify: async (identity) => ({ receivedIdentity: identity }),
      }

      executor.addHook(hook)

      const results = await executor.executeBeforeIdentify('user-123')

      expect(results).toEqual([
        { hook: 'identify-hook', data: { receivedIdentity: 'user-123' } },
      ])
    })
  })

  describe('executeAfterIdentify', () => {
    it('should execute hooks in LIFO order', async () => {
      const order: string[] = []

      const hook1: Hook = {
        getMetadata: () => ({ name: 'hook-1' }),
        afterIdentify: async () => {
          order.push('hook-1')
        },
      }

      const hook2: Hook = {
        getMetadata: () => ({ name: 'hook-2' }),
        afterIdentify: async () => {
          order.push('hook-2')
        },
      }

      executor.addHook(hook1)
      executor.addHook(hook2)

      await executor.executeAfterIdentify('user-123', [])

      expect(order).toEqual(['hook-2', 'hook-1'])
    })
  })

  describe('executeAfterRefresh', () => {
    it('should execute hooks with features', async () => {
      const receivedFeatures = vi.fn()

      const hook: Hook = {
        getMetadata: () => ({ name: 'refresh-hook' }),
        afterRefresh: async (features) => {
          receivedFeatures(features)
        },
      }

      executor.addHook(hook)

      const features = { 'feature-a': true, 'feature-b': false }
      await executor.executeAfterRefresh(features)

      expect(receivedFeatures).toHaveBeenCalledWith(features)
    })
  })

  describe('executeOnError', () => {
    it('should execute error hooks', async () => {
      const receivedError = vi.fn()

      const hook: Hook = {
        getMetadata: () => ({ name: 'error-hook' }),
        onError: async (error, context) => {
          receivedError(error.message, context)
        },
      }

      executor.addHook(hook)

      await executor.executeOnError(new Error('Test error'), 'test-context')

      expect(receivedError).toHaveBeenCalledWith('Test error', 'test-context')
    })

    it('should not propagate errors from error hooks', async () => {
      const hook: Hook = {
        getMetadata: () => ({ name: 'failing-error-hook' }),
        onError: async () => {
          throw new Error('Error in error hook')
        },
      }

      executor.addHook(hook)

      // Should not throw
      await executor.executeOnError(new Error('Original error'), 'context')
    })
  })

  describe('clear', () => {
    it('should remove all hooks', () => {
      executor.addHook({ getMetadata: () => ({ name: 'hook-1' }) })
      executor.addHook({ getMetadata: () => ({ name: 'hook-2' }) })

      executor.clear()

      expect(executor.getHooks()).toHaveLength(0)
    })
  })
})

describe('createLoggingHook', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should create a hook with default name', () => {
    const hook = createLoggingHook()
    expect(hook.getMetadata().name).toBe('logging-hook')
  })

  it('should create a hook with custom name', () => {
    const hook = createLoggingHook('my-logger')
    expect(hook.getMetadata().name).toBe('my-logger')
  })

  it('should log on beforeEvaluation', async () => {
    const hook = createLoggingHook()
    const context = { identity: 'user-123' }
    await hook.beforeEvaluation!('my-feature', context)

    expect(console.log).toHaveBeenCalledWith(
      '[Toggly] Evaluating flag "my-feature"',
      expect.objectContaining({ context })
    )
  })

  it('should log on afterEvaluation', async () => {
    const hook = createLoggingHook()
    const context = { identity: 'user-123' }
    await hook.afterEvaluation!('my-feature', context, { startTime: Date.now() - 10 }, true)

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[Toggly\] Flag "my-feature" = true/)
    )
  })

  it('should log on beforeIdentify', async () => {
    const hook = createLoggingHook()
    await hook.beforeIdentify!('user-456')

    expect(console.log).toHaveBeenCalledWith(
      '[Toggly] Setting identity: user-456'
    )
  })

  it('should log on afterRefresh', async () => {
    const hook = createLoggingHook()
    await hook.afterRefresh!({ 'feature-a': true, 'feature-b': false })

    expect(console.log).toHaveBeenCalledWith(
      '[Toggly] Features refreshed:',
      2,
      'flags'
    )
  })

  it('should log errors', async () => {
    const hook = createLoggingHook()
    await hook.onError!(new Error('Test error'), 'test-context')

    expect(console.error).toHaveBeenCalledWith(
      '[Toggly] Error in test-context:',
      'Test error'
    )
  })
})
