import { type FeatureUsageScope } from '@ops-ai/toggly-client-telemetry';
import type { EvaluatedDefinitions, Hook, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import { type LocalGate } from '@ops-ai/toggly-local-gates';
import type { EvaluatedVariantDef, VariantResult } from './variant.types';
export type { EvaluatedVariantDef, VariantResult } from './variant.types';
export type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
export { isEntityGate, mapEntityContext, normalizeEntityContext, registerContext } from '@ops-ai/toggly-hooks-types';
/** Partial targeting update; an explicit identity update clears an omitted token. */
export interface TogglyContextUpdate extends TogglyEvaluationContext {
    instanceId?: string;
}
interface EvaluationSnapshot {
    owner: Toggly;
    features: EvaluatedDefinitions | null;
    variants: {
        [key: string]: EvaluatedVariantDef;
    } | null;
    recordCheck?: (featureKey: string, variant: string) => void;
}
export interface TogglyOptions {
    /** Aggregate browser telemetry defaults on with an application key. */
    enableTelemetry?: boolean;
    /** Independent HTTP(S) collector base URL. Default: https://metrics.toggly.io. */
    metricsBaseUrl?: string;
    /** Flush interval from 30000 to 60000 ms, jittered +/-20%. Default: 45000. */
    telemetryFlushIntervalMs?: number;
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
    /** Opaque instance capability supplied by your trusted backend. */
    instanceId?: string;
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
    _evaluateFeatureGate: (gate: string[], requirement: string, negate: boolean, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement: string, negate: boolean, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    isFeatureOn: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    getVariant: (featureKey: string) => VariantResult | null;
    getVariantValue: <T = unknown>(featureKey: string, isT?: (v: unknown) => v is T) => T | null;
    getStringValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<string | null>;
    getNumberValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<number | null>;
    getJsonValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<unknown | null>;
    getDateTimeValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<Date | null>;
    /** @internal Silent projection for cached UI state or an already evaluated component gate. */
    _getVariantSnapshot?: (featureKey: string) => VariantResult | null;
    recordUsage: (featureKey: string, variant?: string) => void;
    use: <T>(featureKey: string, fn: (scope: FeatureUsageScope) => Promise<T>, variant?: string) => Promise<T>;
    recordView: (featureKey: string, variant?: string) => void;
    incrementCounter: (metricKey: string, value?: number) => void;
    setGauge: (metricKey: string, value: number) => void;
    flushTelemetry: () => Promise<void>;
    dispose: () => void;
    subscribeFeaturesRefresh: (listener: () => void) => () => void;
    setLocalGates: (gates: LocalGate[]) => void;
    notifyLocalGatesChanged: () => void;
    subscribeLocalGatesChanged: (listener: () => void) => () => void;
    setContext: (context: TogglyContextUpdate) => Promise<void>;
    registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void;
}
type TogglyEntityContextInput = TogglyEntityContext | Record<string, unknown> | null;
export declare class Toggly implements TogglyService {
    private _config;
    private _features;
    /** Evaluated-signed defs when enableVariants (entity gates + per-call context). */
    private _entityEvaluatedFeatures;
    /** Avoid skipping entity-rail fetch when variant flags were hydrated from cache. */
    private _entityEvaluatedFeaturesSynced;
    private _entityEvaluatedFeaturesLoadPromise;
    private _variants;
    private _loadingFeatures;
    private readonly _hookExecutor;
    private readonly _featuresRefreshListeners;
    private _localGates;
    private _localGateIndex;
    private readonly _localGatesChangedListeners;
    private _lastError;
    private _groups;
    private _claims;
    private _telemetry?;
    private _detachTelemetry?;
    private _generation;
    private _disposed;
    private readonly _isBrowser;
    _ws: WebSocket | null;
    _wsConnected: boolean;
    _wsReconnectTimer: any;
    _wsReconnectAttempt: number;
    _refreshDebounceTimer: any;
    _cachedDefinitionsRevision: string | null;
    _pendingDefinitionsPin: string | null;
    _lastFallbackRefresh: number;
    private readonly _jwks;
    static readonly FALLBACK_REFRESH_INTERVAL: number;
    shouldShowFeatureDuringEvaluation: boolean;
    get lastError(): string | undefined;
    private _reportError;
    private _applyInitialDefaults;
    private _applyFeatureDefaults;
    private _applyDefaultEnvironment;
    private _initializeConfiguredState;
    private _seedCachedFeatures;
    constructor(config: TogglyOptions);
    private _ensureTelemetry;
    private get _definitionsRevision();
    private _cacheDefinitionsRevision;
    private _scheduleDebouncedRefresh;
    private _handleWsSyncMessage;
    private _beginPinnedDefinitionsRefresh;
    private _handleWsUpdateMessage;
    private get _canPersist();
    private _getEvaluationContext;
    private _contextCacheKey;
    private _bodyCacheKey;
    private _revisionScope;
    private _buildDefinitionsUrl;
    private _entityRailRevision;
    private _loadEntityEvaluatedFeatures;
    private _runEntityEvaluatedFeaturesLoad;
    private _syncEntityEvaluatedFeaturesIfNeeded;
    setContext: (context: TogglyContextUpdate) => Promise<void>;
    _loadFeatures: (forceRefresh?: boolean, options?: {
        strict?: boolean;
    }) => Promise<{
        [key: string]: boolean;
    } | null>;
    private _booleanFeatures;
    _featuresLoaded: () => Promise<{
        [key: string]: boolean;
    } | null>;
    private _captureEvaluation;
    private _getEffectiveFlagValue;
    _evaluateFeatureGate: (gate: string[], requirement?: string, negate?: boolean, context?: TogglyEntityContextInput, kind?: string, snapshot?: EvaluationSnapshot) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement?: string, negate?: boolean, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    isFeatureOn: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<boolean>;
    registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void;
    /**
     * Current variant assignment for a feature (requires {@link TogglyOptions.enableVariants} and loaded data).
     */
    getVariant(featureKey: string): VariantResult | null;
    /** @internal Silent projection for cached UI state or an already evaluated component gate. */
    _getVariantSnapshot(featureKey: string): VariantResult | null;
    /**
     * Configuration payload for the assigned variant, if any.
     * Optional `isT` type guard soft-fails to null on mismatch.
     */
    getVariantValue<T = unknown>(featureKey: string, isT?: (v: unknown) => v is T): T | null;
    /**
     * Resolve one typed flag value (OPS-2102).
     *
     * - Not enabled → `null`.
     * - Declared `valueType` (from the evaluated envelope; legacy catalogs omit
     *   it) mismatching `decode`'s own type soft-nulls instead of throwing.
     * - Source value: the evaluated envelope's `value`, else its
     *   `configurationValue`, else the assigned variant's `configurationValue`.
     */
    private _resolveTypedValue;
    /** Typed getter for `string` flag values. Returns `null` when disabled, unset, or mistyped. */
    getStringValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<string | null>;
    /** Typed getter for `number` flag values. Returns `null` when disabled, unset, or mistyped. */
    getNumberValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<number | null>;
    /** Typed getter for `json` flag values (object/array). Returns `null` when disabled, unset, or mistyped. */
    getJsonValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<unknown | null>;
    /** Typed getter for `datetime` flag values, decoded to a `Date`. Returns `null` when disabled, unset, or mistyped. */
    getDateTimeValue: (featureKey: string, context?: TogglyEntityContextInput, kind?: string) => Promise<Date | null>;
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
    /** Record explicit usage without evaluating a feature. */
    recordUsage(featureKey: string, variant?: string): void;
    use<T>(featureKey: string, fn: (scope: FeatureUsageScope) => Promise<T>, variant?: string): Promise<T>;
    /** Record a view without evaluating a feature. */
    recordView(featureKey: string, variant?: string): void;
    incrementCounter(metricKey: string, value?: number): void;
    setGauge(metricKey: string, value: number): void;
    flushTelemetry(): Promise<void>;
    /** Synchronously release resources and attempt one final telemetry flush. */
    dispose(): void;
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
