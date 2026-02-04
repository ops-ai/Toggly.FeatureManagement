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
  async executeBeforeEvaluation(
    flagKey: string,
    defaultValue?: boolean
  ): Promise<Map<string, EvaluationSeriesData | void>> {
    const dataMap = new Map<string, EvaluationSeriesData | void>();

    for (const hook of this.hooks) {
      if (hook.beforeEvaluation) {
        try {
          const data = await hook.beforeEvaluation(flagKey, defaultValue);
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
  async executeAfterEvaluation(
    flagKey: string,
    dataMap: Map<string, EvaluationSeriesData | void>,
    result: boolean
  ): Promise<void> {
    // Execute in reverse order
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterEvaluation) {
        try {
          const data = dataMap.get(hook.getMetadata().name);
          await hook.afterEvaluation(flagKey, data, result);
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
  async executeBeforeIdentify(identity: string): Promise<Map<string, IdentitySeriesData | void>> {
    const dataMap = new Map<string, IdentitySeriesData | void>();

    for (const hook of this.hooks) {
      if (hook.beforeIdentify) {
        try {
          const data = await hook.beforeIdentify(identity);
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
  async executeAfterIdentify(
    identity: string,
    dataMap: Map<string, IdentitySeriesData | void>
  ): Promise<void> {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      if (hook.afterIdentify) {
        try {
          const data = dataMap.get(hook.getMetadata().name);
          await hook.afterIdentify(identity, data);
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
  async executeAfterRefresh(flags: { [key: string]: boolean }): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.afterRefresh) {
        try {
          await hook.afterRefresh(flags);
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
