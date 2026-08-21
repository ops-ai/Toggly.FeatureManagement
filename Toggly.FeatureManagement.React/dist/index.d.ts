/// <reference types="react" />
import * as React from 'react';
import React__default, { ReactNode } from 'react';
import * as _ops_ai_toggly_hooks_types from '@ops-ai/toggly-hooks-types';
import { EvaluatedDefinitions, Hook, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
export { EvaluatedDefinitions, TogglyEntityContext, isEntityGate, mapEntityContext, registerContext } from '@ops-ai/toggly-hooks-types';
import { LocalGate } from '@ops-ai/toggly-local-gates';

/**
 * Assigned variant for a feature (aligned with @ops-ai/feature-flags-toggly).
 */
interface VariantResult {
    name: string;
    configurationValue?: unknown;
}
/**
 * Raw evaluated entry from /evaluated-variants-signed `defs`.
 */
interface EvaluatedVariantDef {
    enabled: boolean;
    variant?: string;
    configurationValue?: unknown;
}

interface TogglyOptions {
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
interface TogglyService {
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
declare class Toggly implements TogglyService {
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

interface TogglyContext {
    toggly?: TogglyService;
}
declare const context: React.Context<TogglyContext>;
declare const Provider: React.Provider<TogglyContext>;
declare const Consumer: React.Consumer<TogglyContext>;

type FeatureProps = {
    featureKey?: string;
    featureKeys?: string[];
    /** When set (with {@link featureKey}), children render only if the assigned variant name matches. */
    variant?: string;
    requirement?: string;
    negate?: boolean;
    /** Entity instance or canonical {@link TogglyEntityContext} for entity-gated flags. */
    context?: TogglyEntityContext | Record<string, unknown> | null;
    /** Context kind for {@link registerContext} mapper lookup when `context` is a domain object. */
    contextKind?: string;
    children?: React__default.ReactNode;
    fallback?: React__default.ReactNode;
    /** Render prop for conditional styling; always invoked with resolved gate boolean. */
    render?: (enabled: boolean) => React__default.ReactNode;
};
declare class Feature extends React__default.Component<FeatureProps, {
    shouldShow: boolean;
}> {
    static contextType: React__default.Context<TogglyContext>;
    context: React__default.ContextType<typeof context>;
    private unsubscribeRefresh;
    private unsubscribeLocalGates;
    constructor(props: FeatureProps);
    private buildGate;
    private applyVariantFilter;
    private runGate;
    componentDidMount(): void;
    componentDidUpdate(prevProps: FeatureProps): void;
    componentWillUnmount(): void;
    render(): string | number | boolean | React__default.ReactFragment | JSX.Element | null | undefined;
}

declare function createTogglyProvider(config: TogglyOptions): Promise<({ children }: {
    children: ReactNode;
}) => JSX.Element>;

/**
 * Subscribes to the current {@link VariantResult} for a feature when variants are enabled on the service.
 * Re-renders after feature definitions refresh (HTTP load or WebSocket update).
 */
declare function useVariant(featureKey: string): VariantResult | null;

interface UseFeatureFlagOptions {
    defaultValue?: boolean;
    negate?: boolean;
    context?: _ops_ai_toggly_hooks_types.TogglyEntityContext | Record<string, unknown> | null;
    contextKind?: string;
}
interface UseFeatureFlagResult {
    isEnabled: boolean;
    isLoading: boolean;
    refresh: () => Promise<void>;
}
interface UseFeatureGateOptions extends UseFeatureFlagOptions {
    requirement?: string;
}
/**
 * Hook to check if a single feature flag is enabled.
 */
declare function useFeatureFlag(featureKey: string, options?: UseFeatureFlagOptions): UseFeatureFlagResult;
/**
 * Hook to evaluate multiple feature keys as a gate.
 */
declare function useFeatureGate(featureKeys: string[], options?: UseFeatureGateOptions): UseFeatureFlagResult;

export { Consumer, EvaluatedVariantDef, Feature, Provider, Toggly, TogglyContext, TogglyOptions, TogglyService, UseFeatureFlagOptions, UseFeatureFlagResult, UseFeatureGateOptions, VariantResult, context, createTogglyProvider, useFeatureFlag, useFeatureGate, useVariant };
