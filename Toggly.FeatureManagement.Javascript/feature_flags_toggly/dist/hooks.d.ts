import type { Hook, EvaluationSeriesData, IdentitySeriesData } from '@ops-ai/toggly-hooks-types';
/**
 * Internal class that manages hook registration and execution
 */
export declare class HookExecutor {
    private hooks;
    /**
     * Register a new hook
     */
    addHook(hook: Hook): void;
    /**
     * Remove a hook by name
     * @returns true if hook was found and removed, false otherwise
     */
    removeHook(name: string): boolean;
    /**
     * Execute beforeEvaluation hooks in registration order (FIFO)
     * Collects data from each hook to pass to afterEvaluation
     */
    executeBeforeEvaluation(flagKey: string, defaultValue?: boolean): Promise<Map<string, EvaluationSeriesData | void>>;
    /**
     * Execute afterEvaluation hooks in reverse order (LIFO)
     * Passes data from corresponding beforeEvaluation
     */
    executeAfterEvaluation(flagKey: string, dataMap: Map<string, EvaluationSeriesData | void>, result: boolean): Promise<void>;
    /**
     * Execute beforeIdentify hooks in registration order (FIFO)
     */
    executeBeforeIdentify(identity: string): Promise<Map<string, IdentitySeriesData | void>>;
    /**
     * Execute afterIdentify hooks in reverse order (LIFO)
     */
    executeAfterIdentify(identity: string, dataMap: Map<string, IdentitySeriesData | void>): Promise<void>;
    /**
     * Execute afterRefresh hooks in registration order (FIFO)
     */
    executeAfterRefresh(flags: {
        [key: string]: boolean;
    }): Promise<void>;
}
