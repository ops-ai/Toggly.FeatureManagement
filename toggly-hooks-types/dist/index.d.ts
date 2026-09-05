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
export type { TogglyEvaluationContext, EvaluationUrlMode, } from './evaluation-context';
export { MAX_EVALUATION_CLAIMS, appendEvaluationContext, buildEvaluatedSignedUrl, evaluationContextCacheKey, normalizeEvaluationClaims, } from './evaluation-context';
export type { EvaluationContextChangeState, EvaluationContextChangeBindings, SetEvaluationContextSafelyOptions, TogglyServiceContextHost, BrowserSdkContextRunner, } from './set-evaluation-context';
export { bindEvaluationContextChangeState, bindTogglyServiceContextState, setBrowserSdkEvaluationContext, setEvaluationContextSafely, } from './set-evaluation-context';
export type { EntityGate, EntityGateRule, EvaluatedDefinitionValue, EvaluatedDefinitions, TogglyEntityContext, EntityContextMapper, } from './entity-gate';
export type { CacheLruEntry, CacheLruIndex, } from './cache-lru';
export { emptyCacheLruIndex, isCacheLruEnabled, parseCacheLruIndex, removeCacheLruKeys, selectCacheLruKeysToEvict, serializeCacheLruIndex, touchCacheLruKey, } from './cache-lru';
export { serializeJsonForInlineScript } from './serialize-for-inline-script';
export type { EvaluatedGateRequirement } from './entity-gate';
export { applyEntityGate, clearRegisteredContexts, evaluateEvaluatedGate, evaluateResolvedKeys, evaluateStoredFeatureKeys, isEntityGate, mapEntityContext, normalizeEntityContext, registerContext, resolveEntityContext, resolveEvaluatedDefinition, toBooleanDefinitions, } from './entity-gate';
