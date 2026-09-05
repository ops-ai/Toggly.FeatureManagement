import type { TogglyEvaluationContext } from './evaluation-context';
export interface EvaluationContextChangeState<TFeatures = unknown, TVariants = unknown> {
    identity?: string;
    groups: string[];
    claims: Record<string, string>;
    features: TFeatures | null;
    variants: TVariants | null;
}
export interface SetEvaluationContextSafelyOptions<TFeatures, TVariants> {
    readState: () => EvaluationContextChangeState<TFeatures, TVariants>;
    writeState: (state: EvaluationContextChangeState<TFeatures, TVariants>) => void;
    notifyRefresh: () => void;
    refreshStrict: () => Promise<unknown>;
}
export interface EvaluationContextChangeBindings<TFeatures, TVariants> {
    identity: {
        get: () => string | undefined;
        set: (value: string | undefined) => void;
    };
    groups: {
        get: () => string[];
        set: (value: string[]) => void;
    };
    claims: {
        get: () => Record<string, string>;
        set: (value: Record<string, string>) => void;
    };
    features: {
        get: () => TFeatures | null;
        set: (value: TFeatures | null) => void;
    };
    variants: {
        get: () => TVariants | null;
        set: (value: TVariants | null) => void;
    };
}
export interface TogglyServiceContextHost<TFeatures, TVariants> {
    _config: {
        identity?: string;
        featureDefaults?: Record<string, unknown>;
    };
    _groups: string[];
    _claims: Record<string, string>;
    _features: TFeatures | null;
    _variants: TVariants | null;
}
export declare function bindEvaluationContextChangeState<TFeatures, TVariants>(bindings: EvaluationContextChangeBindings<TFeatures, TVariants>): Pick<SetEvaluationContextSafelyOptions<TFeatures, TVariants>, 'readState' | 'writeState'>;
export declare function bindTogglyServiceContextState<TFeatures, TVariants>(host: TogglyServiceContextHost<TFeatures, TVariants>): Pick<SetEvaluationContextSafelyOptions<TFeatures, TVariants>, 'readState' | 'writeState'>;
export interface BrowserSdkContextRunner {
    notifyFeaturesRefresh(): void;
    loadFeaturesStrict(): Promise<unknown>;
}
export declare function setBrowserSdkEvaluationContext<TFeatures, TVariants>(host: TogglyServiceContextHost<TFeatures, TVariants>, context: TogglyEvaluationContext, featureDefaults: Record<string, unknown>, runner: BrowserSdkContextRunner): Promise<void>;
/**
 * Withhold prior evaluated state, apply partial context updates, and refresh under
 * strict mode. Restores the prior snapshot when refresh fails.
 */
export declare function setEvaluationContextSafely<TFeatures, TVariants>(context: TogglyEvaluationContext, featureDefaults: Record<string, unknown>, options: SetEvaluationContextSafelyOptions<TFeatures, TVariants>): Promise<void>;
