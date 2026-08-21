import type { EvaluatedDefinitions, Hook, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { type LocalGate } from '@ops-ai/toggly-local-gates';
import type { VariantResult } from './variant.types';
export type { EvaluatedVariantDef, VariantResult } from './variant.types';
export type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
export { isEntityGate, mapEntityContext, registerContext } from '@ops-ai/toggly-hooks-types';
export interface TogglyOptions {
    baseURI?: string;
    verifySignatures?: boolean;
    /**
     * When verifySignatures is enabled, only accept signatures from these key IDs.
     * Omit / empty = any kid present in JWKS is accepted.
     */
    allowedKeyIds?: string[];
    /**
     * Reject signed envelopes older than this many seconds when verifySignatures is enabled.
     * Omit / null / <=0 = disabled (back-compat).
     */
    maxSignatureAgeSeconds?: number | null;
    appKey?: string;
    environment?: string;
    identity?: string;
    groups?: string[];
    claims?: Record<string, string>;
    featureDefaults?: EvaluatedDefinitions;
    showFeatureDuringEvaluation?: boolean;
    /** Hooks to extend SDK behavior at key lifecycle points */
    hooks?: Hook[];
    /** Enable WebSocket live updates (defaults to true when appKey is set) */
    enableLiveUpdates?: boolean;
    /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
    persistCache?: boolean;
    /** Max identity-scoped cache keys (flags/variants). null/omit = unlimited. */
    maxCacheKeys?: number | null;
    /**
     * Use /evaluated-variants-signed and expose {@link Toggly.getVariant} / {@link Toggly.getVariantValue}.
     * Matches @ops-ai/feature-flags-toggly when enableVariants is true.
     */
    enableVariants?: boolean;
    /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
    localGates?: LocalGate[];
    /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
    onError?: (message: string, error?: unknown) => void;
}
export interface TogglyService {
    shouldShowFeatureDuringEvaluation: boolean;
    _loadFeatures: () => Promise<{
        [key: string]: boolean;
    } | null>;
    _featuresLoaded: () => Promise<{
        [key: string]: boolean;
    } | null>;
    _evaluateFeatureGate: (gate: string[], requirement: string, negate: boolean, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement: string, negate: boolean, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    isFeatureOn: (featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    getVariant: (featureKey: string) => VariantResult | null;
    getVariantValue: (featureKey: string) => unknown | null;
    subscribeFeaturesRefresh: (listener: () => void) => () => void;
    setLocalGates: (gates: LocalGate[]) => void;
    notifyLocalGatesChanged: () => void;
    subscribeLocalGatesChanged: (listener: () => void) => () => void;
    setContext: (context: TogglyEvaluationContext) => Promise<void>;
    registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void;
}
export declare class Toggly implements TogglyService {
    private _config;
    private _features;
    private _variants;
    private _loadingFeatures;
    private _hookExecutor;
    private _featuresRefreshListeners;
    private _localGates;
    private _localGateIndex;
    private _localGatesChangedListeners;
    private _lastError;
    private _groups;
    private _claims;
    _ws: WebSocket | null;
    _wsConnected: boolean;
    _wsReconnectTimer: any;
    _wsReconnectAttempt: number;
    _refreshDebounceTimer: any;
    _cachedDefinitionsRevision: string | null;
    _lastFallbackRefresh: number;
    private _inMemoryJwks;
    static readonly FALLBACK_REFRESH_INTERVAL: number;
    shouldShowFeatureDuringEvaluation: boolean;
    get lastError(): string | undefined;
    private _reportError;
    constructor(config: TogglyOptions);
    private get _definitionsRevision();
    private _cacheDefinitionsRevision;
    private _scheduleDebouncedRefresh;
    private _fetchJwks;
    /**
     * Parse evaluated-signed body. When verifySignatures is enabled, verify ES256
     * against the exact raw defs JSON (Web Crypto double-hash).
     */
    private _readResponseBody;
    private _parseEvaluatedSignedBody;
    private _handleWsSyncMessage;
    private _handleWsUpdateMessage;
    private get _canPersist();
    private _getEvaluationContext;
    private _contextCacheKey;
    setContext: (context: TogglyEvaluationContext) => Promise<void>;
    _loadFeatures: (forceRefresh?: boolean) => Promise<{
        [key: string]: boolean;
    } | null>;
    private _booleanFeatures;
    _featuresLoaded: () => Promise<{
        [key: string]: boolean;
    } | null>;
    private _normalizeEntityContext;
    private _getEffectiveFlagValue;
    _evaluateFeatureGate: (gate: string[], requirement?: string, negate?: boolean, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement?: string, negate?: boolean, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    isFeatureOn: (featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string) => Promise<boolean>;
    registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void;
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
    setLocalGates(gates: LocalGate[]): void;
    notifyLocalGatesChanged(): void;
    subscribeLocalGatesChanged(listener: () => void): () => void;
    startWebSocket: () => void;
    stopWebSocket: () => void;
    /**
     * Force-refresh features from the API (bypasses the loaded cache).
     * Used by WebSocket handlers to pull fresh definitions on update signals.
     */
    private _refreshFeatures;
    /**
     * Clear current identity-scoped flags/variants localStorage entries and update the LRU index.
     */
    clearFeatureFlagsCache(): void;
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
