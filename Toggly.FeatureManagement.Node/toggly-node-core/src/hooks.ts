import type {
  Hook,
  HookMetadata,
  EvaluationContext,
  EvaluationSeriesData,
  IdentitySeriesData,
  FeatureDefinitions,
} from './types.js'
import { createLogger } from './utils.js'

/**
 * Hook executor manages hook registration and execution
 */
export class HookExecutor {
  private hooks: Hook[] = []
  private logger: ReturnType<typeof createLogger>

  constructor(debug = false) {
    this.logger = createLogger(debug)
  }

  /**
   * Add a hook to the executor
   */
  addHook(hook: Hook): void {
    const metadata = hook.getMetadata()

    // Check for duplicate hook names
    if (this.hooks.some((h) => h.getMetadata().name === metadata.name)) {
      this.logger.warn(`Hook "${metadata.name}" is already registered, skipping`)
      return
    }

    this.hooks.push(hook)
    this.logger.debug(`Hook "${metadata.name}" registered`)
  }

  /**
   * Remove a hook by name
   */
  removeHook(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.getMetadata().name === name)

    if (index === -1) {
      return false
    }

    this.hooks.splice(index, 1)
    this.logger.debug(`Hook "${name}" removed`)
    return true
  }

  /**
   * Get all registered hooks
   */
  getHooks(): ReadonlyArray<Hook> {
    return this.hooks
  }

  /**
   * Get hook metadata
   */
  getHookMetadata(): HookMetadata[] {
    return this.hooks.map((h) => h.getMetadata())
  }

  /**
   * Execute beforeEvaluation hooks (FIFO order)
   */
  async executeBeforeEvaluation(
    flagKey: string,
    context: EvaluationContext,
    defaultValue?: boolean
  ): Promise<Array<{ hook: string; data: EvaluationSeriesData | void }>> {
    const results: Array<{ hook: string; data: EvaluationSeriesData | void }> = []

    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        try {
          const data = await hook.beforeEvaluation(flagKey, context, defaultValue)
          results.push({ hook: hook.getMetadata().name, data })
        } catch (error) {
          this.logger.error(
            `Error in beforeEvaluation hook "${hook.getMetadata().name}":`,
            error
          )
          await this.executeOnError(error as Error, `beforeEvaluation:${flagKey}`)
        }
      }
    }

    return results
  }

  /**
   * Execute afterEvaluation hooks (LIFO order)
   */
  async executeAfterEvaluation(
    flagKey: string,
    context: EvaluationContext,
    hookData: Array<{ hook: string; data: EvaluationSeriesData | void }>,
    result: boolean
  ): Promise<void> {
    // Reverse order for after hooks (LIFO)
    const reversedHooks = [...this.hooks].reverse()

    for (const hook of reversedHooks) {
      if (hook.afterEvaluation) {
        const dataEntry = hookData.find((d) => d.hook === hook.getMetadata().name)

        try {
          await hook.afterEvaluation(flagKey, context, dataEntry?.data, result)
        } catch (error) {
          this.logger.error(
            `Error in afterEvaluation hook "${hook.getMetadata().name}":`,
            error
          )
          await this.executeOnError(error as Error, `afterEvaluation:${flagKey}`)
        }
      }
    }
  }

  /**
   * Execute beforeIdentify hooks (FIFO order)
   */
  async executeBeforeIdentify(
    identity: string
  ): Promise<Array<{ hook: string; data: IdentitySeriesData | void }>> {
    const results: Array<{ hook: string; data: IdentitySeriesData | void }> = []

    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        try {
          const data = await hook.beforeIdentify(identity)
          results.push({ hook: hook.getMetadata().name, data })
        } catch (error) {
          this.logger.error(
            `Error in beforeIdentify hook "${hook.getMetadata().name}":`,
            error
          )
          await this.executeOnError(error as Error, `beforeIdentify:${identity}`)
        }
      }
    }

    return results
  }

  /**
   * Execute afterIdentify hooks (LIFO order)
   */
  async executeAfterIdentify(
    identity: string,
    hookData: Array<{ hook: string; data: IdentitySeriesData | void }>
  ): Promise<void> {
    const reversedHooks = [...this.hooks].reverse()

    for (const hook of reversedHooks) {
      if (hook.afterIdentify) {
        const dataEntry = hookData.find((d) => d.hook === hook.getMetadata().name)

        try {
          await hook.afterIdentify(identity, dataEntry?.data)
        } catch (error) {
          this.logger.error(
            `Error in afterIdentify hook "${hook.getMetadata().name}":`,
            error
          )
          await this.executeOnError(error as Error, `afterIdentify:${identity}`)
        }
      }
    }
  }

  /**
   * Execute afterRefresh hooks (FIFO order)
   */
  async executeAfterRefresh(features: FeatureDefinitions): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        try {
          await hook.afterRefresh(features)
        } catch (error) {
          this.logger.error(
            `Error in afterRefresh hook "${hook.getMetadata().name}":`,
            error
          )
          await this.executeOnError(error as Error, 'afterRefresh')
        }
      }
    }
  }

  /**
   * Execute onError hooks (FIFO order)
   */
  async executeOnError(error: Error, context?: string): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.onError) {
        try {
          await hook.onError(error, context)
        } catch (hookError) {
          // Avoid infinite loops - just log and continue
          this.logger.error(
            `Error in onError hook "${hook.getMetadata().name}":`,
            hookError
          )
        }
      }
    }
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = []
  }
}

/**
 * Create a simple logging hook
 */
export function createLoggingHook(name = 'logging-hook'): Hook {
  return {
    getMetadata: () => ({ name, version: '1.0.0' }),

    beforeEvaluation: async (flagKey, context) => {
      console.log(`[Toggly] Evaluating flag "${flagKey}"`, { context })
      return { startTime: Date.now() }
    },

    afterEvaluation: async (flagKey, _context, data, result) => {
      const startTime = (data as { startTime?: number })?.startTime
      const duration = startTime ? Date.now() - startTime : 0
      console.log(`[Toggly] Flag "${flagKey}" = ${result} (${duration}ms)`)
    },

    beforeIdentify: async (identity) => {
      console.log(`[Toggly] Setting identity: ${identity}`)
      return { startTime: Date.now() }
    },

    afterIdentify: async (identity, data) => {
      const startTime = (data as { startTime?: number })?.startTime
      const duration = startTime ? Date.now() - startTime : 0
      console.log(`[Toggly] Identity set: ${identity} (${duration}ms)`)
    },

    afterRefresh: async (features) => {
      console.log(`[Toggly] Features refreshed:`, Object.keys(features).length, 'flags')
    },

    onError: async (error, context) => {
      console.error(`[Toggly] Error in ${context}:`, error.message)
    },
  }
}
