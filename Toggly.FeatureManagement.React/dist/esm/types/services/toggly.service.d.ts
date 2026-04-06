import type { Hook } from '@ops-ai/toggly-hooks-types';
import type { VariantResult } from './variant.types';
export type { EvaluatedVariantDef, VariantResult } from './variant.types';
export interface TogglyOptions {
    baseURI?: string;
    verifySignatures?: boolean;
    appKey?: string;
    environment?: string;
    identity?: string;
    featureDefaults?: {
        [key: string]: boolean;
    };
    showFeatureDuringEvaluation?: boolean;
    /** Hooks to extend SDK behavior at key lifecycle points */
    hooks?: Hook[];
    /** Enable WebSocket live updates (defaults to true when appKey is set) */
    enableLiveUpdates?: boolean;
    /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
    persistCache?: boolean;
    /**
     * Use /evaluated-variants-signed and expose {@link Toggly.getVariant} / {@link Toggly.getVariantValue}.
     * Matches @ops-ai/feature-flags-toggly when enableVariants is true.
     */
    enableVariants?: boolean;
}
export interface TogglyService {
    shouldShowFeatureDuringEvaluation: boolean;
    _loadFeatures: () => Promise<{
        [key: string]: boolean;
    } | null>;
    _featuresLoaded: () => Promise<{
        [key: string]: boolean;
    } | null>;
    _evaluateFeatureGate: (gate: string[], requirement: string, negate: boolean) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement: string, negate: boolean) => Promise<boolean>;
    isFeatureOn: (featureKey: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string) => Promise<boolean>;
    getVariant: (featureKey: string) => VariantResult | null;
    getVariantValue: (featureKey: string) => unknown | null;
    subscribeFeaturesRefresh: (listener: () => void) => () => void;
}
export declare class Toggly implements TogglyService {
    private _config;
    private _features;
    private _variants;
    private _loadingFeatures;
    private _hookExecutor;
    private _featuresRefreshListeners;
    _ws: WebSocket | null;
    _wsConnected: boolean;
    _wsReconnectTimer: any;
    _lastFallbackRefresh: number;
    static readonly FALLBACK_REFRESH_INTERVAL: number;
    static readonly WS_RECONNECT_DELAY = 5000;
    shouldShowFeatureDuringEvaluation: boolean;
    constructor(config: TogglyOptions);
    private get _canPersist();
    _loadFeatures: () => Promise<{
        [key: string]: boolean;
    } | null>;
    _featuresLoaded: () => Promise<{
        [key: string]: boolean;
    } | null>;
    _evaluateFeatureGate: (gate: string[], requirement?: string, negate?: boolean) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement?: string, negate?: boolean) => Promise<boolean>;
    isFeatureOn: (featureKey: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string) => Promise<boolean>;
    /**
     * Current variant assignment for a feature (requires {@link TogglyOptions.enableVariants} and loaded data).
     */
    getVariant(featureKey: string): VariantResult | null;
    /**
     * Configuration payload for the assigned variant, if any.
     */
    getVariantValue(featureKey: string): unknown | null;
    /**
     * Subscribe to feature (and variant) data updates after HTTP refresh or WebSocket-driven reload.
     * @returns Unsubscribe function.
     */
    subscribeFeaturesRefresh(listener: () => void): () => void;
    private notifyFeaturesRefresh;
    startWebSocket: () => void;
    stopWebSocket: () => void;
    /**
     * Force-refresh features from the API (bypasses the loaded cache).
     * Used by WebSocket handlers to pull fresh definitions on update signals.
     */
    private _refreshFeatures;
    /**
     * Add a hook dynamically
     */
    addHook(hook: Hook): void;
    /**
     * Remove a hook by name
     * @returns true if hook was found and removed, false otherwise
     */
    removeHook(name: string): boolean;
}
export default Toggly;
