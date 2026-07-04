/// <reference types="react" />
import * as React from 'react';
import React__default, { ReactNode } from 'react';
import { Hook } from '@ops-ai/toggly-hooks-types';
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
    _evaluateFeatureGate: (gate: string[], requirement: string, negate: boolean) => Promise<boolean>;
    evaluateFeatureGate: (featureKeys: string[], requirement: string, negate: boolean) => Promise<boolean>;
    isFeatureOn: (featureKey: string) => Promise<boolean>;
    isFeatureOff: (featureKey: string) => Promise<boolean>;
    getVariant: (featureKey: string) => VariantResult | null;
    getVariantValue: (featureKey: string) => unknown | null;
    subscribeFeaturesRefresh: (listener: () => void) => () => void;
    setLocalGates: (gates: LocalGate[]) => void;
    notifyLocalGatesChanged: () => void;
    subscribeLocalGatesChanged: (listener: () => void) => () => void;
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
    _ws: WebSocket | null;
    _wsConnected: boolean;
    _wsReconnectTimer: any;
    _lastFallbackRefresh: number;
    static readonly FALLBACK_REFRESH_INTERVAL: number;
    static readonly WS_RECONNECT_DELAY = 5000;
    shouldShowFeatureDuringEvaluation: boolean;
    get lastError(): string | undefined;
    private _reportError;
    constructor(config: TogglyOptions);
    private get _canPersist();
    _loadFeatures: (forceRefresh?: boolean) => Promise<{
        [key: string]: boolean;
    } | null>;
    _featuresLoaded: () => Promise<{
        [key: string]: boolean;
    } | null>;
    private _getEffectiveFlagValue;
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
    children: React__default.ReactNode;
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
    render(): React__default.ReactNode;
}

declare function createTogglyProvider(config: TogglyOptions): Promise<({ children }: {
    children: ReactNode;
}) => JSX.Element>;

/**
 * Subscribes to the current {@link VariantResult} for a feature when variants are enabled on the service.
 * Re-renders after feature definitions refresh (HTTP load or WebSocket update).
 */
declare function useVariant(featureKey: string): VariantResult | null;

export { Consumer, EvaluatedVariantDef, Feature, Provider, Toggly, TogglyContext, TogglyOptions, TogglyService, VariantResult, context, createTogglyProvider, useVariant };
