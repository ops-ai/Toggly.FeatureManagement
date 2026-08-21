export interface UseFeatureFlagOptions {
    defaultValue?: boolean;
    negate?: boolean;
    context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null;
    contextKind?: string;
}
export interface UseFeatureFlagResult {
    isEnabled: boolean;
    isLoading: boolean;
    refresh: () => Promise<void>;
}
export interface UseFeatureGateOptions extends UseFeatureFlagOptions {
    requirement?: string;
}
/**
 * Hook to check if a single feature flag is enabled.
 */
export declare function useFeatureFlag(featureKey: string, options?: UseFeatureFlagOptions): UseFeatureFlagResult;
/**
 * Hook to evaluate multiple feature keys as a gate.
 */
export declare function useFeatureGate(featureKeys: string[], options?: UseFeatureGateOptions): UseFeatureFlagResult;
