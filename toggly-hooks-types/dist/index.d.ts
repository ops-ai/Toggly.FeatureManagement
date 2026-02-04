/**
 * Hook metadata
 */
export interface HookMetadata {
    name: string;
}
/**
 * Data passed between beforeEvaluation and afterEvaluation stages
 */
export interface EvaluationSeriesData {
    flagKey: string;
    defaultValue?: boolean;
    [key: string]: any;
}
/**
 * Data passed between beforeIdentify and afterIdentify stages
 */
export interface IdentitySeriesData {
    identity: string;
    [key: string]: any;
}
/**
 * Hook interface - developer-defined callbacks executed at SDK lifecycle points
 */
export interface Hook {
    /**
     * Returns hook metadata (name must be unique)
     */
    getMetadata(): HookMetadata;
    /**
     * Called before feature flag evaluation
     * Return value is passed to afterEvaluation
     */
    beforeEvaluation?(flagKey: string, defaultValue?: boolean): Promise<EvaluationSeriesData | void> | EvaluationSeriesData | void;
    /**
     * Called after feature flag evaluation
     * @param flagKey - Feature flag key that was evaluated
     * @param data - Data returned from beforeEvaluation
     * @param result - Evaluation result (true/false)
     */
    afterEvaluation?(flagKey: string, data: EvaluationSeriesData | void, result: boolean): Promise<void> | void;
    /**
     * Called before identity is set or changed
     * Return value is passed to afterIdentify
     */
    beforeIdentify?(identity: string): Promise<IdentitySeriesData | void> | IdentitySeriesData | void;
    /**
     * Called after identity has been set or changed
     * @param identity - The identity string
     * @param data - Data returned from beforeIdentify
     */
    afterIdentify?(identity: string, data: IdentitySeriesData | void): Promise<void> | void;
    /**
     * Called when feature flags are refreshed from the server
     * @param flags - Updated flags object
     */
    afterRefresh?(flags: {
        [key: string]: boolean;
    }): Promise<void> | void;
}
