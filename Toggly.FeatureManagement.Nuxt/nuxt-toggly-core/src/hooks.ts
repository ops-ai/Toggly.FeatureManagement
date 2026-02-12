import type {
  Hook,
  EvaluationSeriesData,
  IdentitySeriesData,
  FeatureDefinitions,
} from './types'

/**
 * Hook executor that manages hook lifecycle
 */
export class HookExecutor {
  private hooks: Hook[] = []

  /**
   * Add a hook to the executor
   * @param hook - Hook to add
   * @throws Error if hook with same name already exists
   */
  addHook(hook: Hook): void {
    const metadata = hook.getMetadata()
    if (this.hooks.some((h) => h.getMetadata().name === metadata.name)) {
      console.warn(
        `[Toggly] Hook with name "${metadata.name}" already exists. Skipping.`
      )
      return
    }
    this.hooks.push(hook)
  }

  /**
   * Remove a hook by name
   * @param name - Name of the hook to remove
   * @returns true if hook was removed, false if not found
   */
  removeHook(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.getMetadata().name === name)
    if (index === -1) {
      return false
    }
    this.hooks.splice(index, 1)
    return true
  }

  /**
   * Get all registered hooks
   */
  getHooks(): readonly Hook[] {
    return this.hooks
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
    this.hooks = []
  }

  /**
   * Execute beforeEvaluation hooks in FIFO order
   */
  async executeBeforeEvaluation(
    flagKey: string,
    defaultValue?: boolean
  ): Promise<Map<string, EvaluationSeriesData | void>> {
    const dataMap = new Map<string, EvaluationSeriesData | void>()

    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        try {
          const data = await hook.beforeEvaluation(flagKey, defaultValue)
          dataMap.set(hook.getMetadata().name, data)
        } catch (error) {
          console.error(
            `[Toggly] Error in beforeEvaluation hook "${hook.getMetadata().name}":`,
            error
          )
          dataMap.set(hook.getMetadata().name, undefined)
        }
      }
    }

    return dataMap
  }

  /**
   * Execute afterEvaluation hooks in LIFO order
   */
  async executeAfterEvaluation(
    flagKey: string,
    dataMap: Map<string, EvaluationSeriesData | void>,
    result: boolean
  ): Promise<void> {
    // Execute in reverse order (LIFO)
    const reversedHooks = [...this.hooks].reverse()

    for (const hook of reversedHooks) {
      if (hook.afterEvaluation) {
        try {
          const data = dataMap.get(hook.getMetadata().name)
          await hook.afterEvaluation(flagKey, data, result)
        } catch (error) {
          console.error(
            `[Toggly] Error in afterEvaluation hook "${hook.getMetadata().name}":`,
            error
          )
        }
      }
    }
  }

  /**
   * Execute beforeIdentify hooks in FIFO order
   */
  async executeBeforeIdentify(
    identity: string
  ): Promise<Map<string, IdentitySeriesData | void>> {
    const dataMap = new Map<string, IdentitySeriesData | void>()

    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        try {
          const data = await hook.beforeIdentify(identity)
          dataMap.set(hook.getMetadata().name, data)
        } catch (error) {
          console.error(
            `[Toggly] Error in beforeIdentify hook "${hook.getMetadata().name}":`,
            error
          )
          dataMap.set(hook.getMetadata().name, undefined)
        }
      }
    }

    return dataMap
  }

  /**
   * Execute afterIdentify hooks in LIFO order
   */
  async executeAfterIdentify(
    identity: string,
    dataMap: Map<string, IdentitySeriesData | void>
  ): Promise<void> {
    const reversedHooks = [...this.hooks].reverse()

    for (const hook of reversedHooks) {
      if (hook.afterIdentify) {
        try {
          const data = dataMap.get(hook.getMetadata().name)
          await hook.afterIdentify(identity, data)
        } catch (error) {
          console.error(
            `[Toggly] Error in afterIdentify hook "${hook.getMetadata().name}":`,
            error
          )
        }
      }
    }
  }

  /**
   * Execute afterRefresh hooks
   */
  async executeAfterRefresh(flags: FeatureDefinitions): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        try {
          await hook.afterRefresh(flags)
        } catch (error) {
          console.error(
            `[Toggly] Error in afterRefresh hook "${hook.getMetadata().name}":`,
            error
          )
        }
      }
    }
  }
}
