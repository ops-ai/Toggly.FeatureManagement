import { FeatureRequirement, TogglyConfig, VariantResult, EvaluatedVariantDef } from './models';
import type { Hook, TogglyEvaluationContext, EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import { type LocalGate } from '@ops-ai/toggly-local-gates';
export declare class Toggly {
    private static _config;
    private static _contextMemory;
    private static _contextMemoryOnly;
    private static _refreshInterval;
    private static _hookExecutor;
    private static _localGates;
    private static _inMemoryJwks;
    private static _localGateIndex;
    private static _localGatesChangedListeners;
    private static _inMemoryFlags;
    private static _hasLoadedFlags;
    private static _lastError;
    static _ws: WebSocket | null;
    static _wsConnected: boolean;
    static _wsReconnectTimer: any;
    static _wsReconnectAttempt: number;
    static _refreshDebounceTimer: any;
    static _cachedDefinitionsRevision: string | null;
    private static _cachedRevisionContext;
    static _pendingDefinitionsPin: string | null;
    static _lastFallbackRefresh: number;
    static _fallbackRefreshInterval: number;
    private static get _revisionCacheKey();
    private static get definitionsRevision();
    private static cacheDefinitionsRevision;
    private static scheduleDebouncedRefresh;
    private static handleWsSyncMessage;
    private static handleWsUpdateMessage;
    private static buildFetchHeaders;
    /**
     * Consume a one-shot WS pin: append ?rev= and omit If-None-Match so the
     * post-notify GET cannot 304 against a revision that HTTP has not confirmed.
     */
    private static consumePendingDefinitionsRequest;
    private static applyFetchRevision;
    private static get _persistCache();
    private static get _contextCacheKey();
    private static get _flagsCacheKey();
    static get lastError(): string | undefined;
    private static _reportError;
    private static _getFallbackFlags;
    private static get _variantsCacheKey();
    static init(config?: TogglyConfig): Promise<{
        [key: string]: boolean;
    }>;
    static get featureFlagsValue(): EvaluatedDefinitions;
    private static readContextValue;
    private static writeContextValue;
    static get identity(): string;
    static set identity(v: string);
    static clearIdentity(): void;
    static get groups(): string[];
    static set groups(values: string[]);
    static get claims(): Record<string, string>;
    static set claims(values: Record<string, string>);
    static get evaluationContext(): TogglyEvaluationContext;
    static setContext(context: TogglyEvaluationContext): Promise<{
        [key: string]: boolean;
    }>;
    static clearContext(): Promise<{
        [key: string]: boolean;
    }>;
    private static buildEvaluatedUrl;
    private static fetchJwks;
    /** Prefer text() for raw defs verification; fall back to json() for test doubles. */
    private static readResponseBody;
    /**
     * Parse evaluated-signed body. When verifySignatures is enabled, verify ES256
     * against the exact raw defs JSON (Web Crypto double-hash), matching Go/Node.
     */
    private static parseEvaluatedSignedBody;
    private static get _cachedFeatureFlags();
    static cacheFeatureFlags(flags: EvaluatedDefinitions): void;
    static clearFeatureFlagsCache(): void;
    static get variantsValue(): {
        [key: string]: EvaluatedVariantDef;
    } | null;
    static cacheVariants(variants: {
        [key: string]: EvaluatedVariantDef;
    }): void;
    private static _isTrackedCacheKey;
    private static _loadLruIndex;
    private static _saveLruIndex;
    private static _touchCacheKey;
    private static _enforceMaxCacheKeys;
    private static _removeCacheKeysFromLruIndex;
    /**
     * Get the assigned variant for a feature flag.
     * Returns null if no variant is assigned or variants are not enabled.
     */
    static getVariant(featureKey: string): VariantResult | null;
    /**
     * Get the configuration value of the assigned variant for a feature flag.
     * Returns null if no variant is assigned or no configuration value is set.
     */
    static getVariantValue(featureKey: string): unknown | null;
    static fetchFeatureFlags(): Promise<{
        [key: string]: boolean;
    }>;
    private static fetchFeatureFlagsWithVariants;
    static refresh(): Promise<{
        [key: string]: boolean;
    }>;
    private static _getEffectiveFlagValue;
    private static _isEffectiveFlagEnabled;
    private static _evaluateFeatureGate;
    static evaluateFeatureGate(featureGate: string[], requirement?: FeatureRequirement, negate?: boolean, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): boolean;
    static isFeatureOn(featureKey: string, context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): boolean;
    static registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void;
    static isFeatureOff(featureKey: string): boolean;
    /**
     * Add a hook dynamically
     */
    static addHook(hook: Hook): void;
    /**
     * Remove a hook by name
     * @returns true if hook was found and removed, false otherwise
     */
    static removeHook(name: string): boolean;
    /**
     * Register device-local gates applied as a read-time AND on worker booleans.
     */
    static setLocalGates(gates: LocalGate[]): void;
    /**
     * Notify subscribers that local gate state changed (no network fetch).
     */
    static notifyLocalGatesChanged(): void;
    /**
     * Subscribe to local gate changes. Returns an unsubscribe function.
     */
    static subscribeLocalGatesChanged(listener: () => void): () => void;
    static startWebSocket(): void;
    static stopWebSocket(): void;
    static cancelRefreshInterval(): void;
    static startRefreshInterval(): void;
}
