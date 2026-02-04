import type { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';

/**
 * Internal class that manages hook registration and execution
 */
export class HookExecutor {
  private hooks: Hook[] = [];

  /**
   * Register a new hook
   */
  addHook(hook: Hook): void {
    const metadata = hook.getMetadata();
    
    // Check for duplicate hook names
    const existingHook = this.hooks.find(h => h.getMetadata().name === metadata.name);
    if (existingHook) {
      console.warn(`[Toggly] Hook with name "${metadata.name}" already registered. Skipping.`);
      return;
    }
    
    this.hooks.push(hook);
  }

  /**
   * Remove a hook by name
   * @returns true if hook was found and removed, false otherwise
   */
  removeHook(name: string): boolean {
    const index = this.hooks.findIndex(h => h.getMetadata().name === name);
    if (index > -1) {
      this.hooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Execute beforeEvaluation hooks in registration order (FIFO)
   * Collects data from each hook to pass to afterEvaluation
   */
  executeBeforeEvaluation(
    flagKey: string,
    defaultValue?: boolean
  ): Map<string, EvaluationSeriesData | void> {
    const dataMap = new Map<string, EvaluationSeriesData | void>();
    
    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        try {
          const data = hook.beforeEvaluation(flagKey, defaultValue);
          dataMap.set(hook.getMetadata().name, data);
        } catch (error) {
          console.error(
            `[Toggly] Error in hook "${hook.getMetadata().name}.beforeEvaluation":`,
            error
          );
        }
      }
    }
    
    return dataMap;
  }

  /**
   * Execute afterEvaluation hooks in reverse order (LIFO)
   * Passes data from corresponding beforeEvaluation
   */
  executeAfterEvaluation(
    flagKey: string,
    dataMap: Map<string, EvaluationSeriesData | void>,
    result: boolean
  ): void {
    // Execute in reverse order
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterEvaluation) {
        try {
          const data = dataMap.get(hook.getMetadata().name);
          hook.afterEvaluation(flagKey, data, result);
        } catch (error) {
          console.error(
            `[Toggly] Error in hook "${hook.getMetadata().name}.afterEvaluation":`,
            error
          );
        }
      }
    }
  }

  /**
   * Execute beforeIdentify hooks in registration order (FIFO)
   */
  executeBeforeIdentify(identity: string): Map<string, IdentitySeriesData | void> {
    const dataMap = new Map<string, IdentitySeriesData | void>();
    
    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        try {
          const data = hook.beforeIdentify(identity);
          dataMap.set(hook.getMetadata().name, data);
        } catch (error) {
          console.error(
            `[Toggly] Error in hook "${hook.getMetadata().name}.beforeIdentify":`,
            error
          );
        }
      }
    }
    
    return dataMap;
  }

  /**
   * Execute afterIdentify hooks in reverse order (LIFO)
   */
  executeAfterIdentify(
    identity: string,
    dataMap: Map<string, IdentitySeriesData | void>
  ): void {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterIdentify) {
        try {
          const data = dataMap.get(hook.getMetadata().name);
          hook.afterIdentify(identity, data);
        } catch (error) {
          console.error(
            `[Toggly] Error in hook "${hook.getMetadata().name}.afterIdentify":`,
            error
          );
        }
      }
    }
  }

  /**
   * Execute afterRefresh hooks in registration order (FIFO)
   */
  executeAfterRefresh(flags: { [key: string]: boolean }): void {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        try {
          hook.afterRefresh(flags);
        } catch (error) {
          console.error(
            `[Toggly] Error in hook "${hook.getMetadata().name}.afterRefresh":`,
            error
          );
        }
      }
    }
  }
}
