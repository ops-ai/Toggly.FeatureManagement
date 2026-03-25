/// <reference types="react" />
import * as React from 'react';
import React__default, { ReactNode } from 'react';
import { Hook } from '@ops-ai/toggly-hooks-types';

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
}
declare class Toggly implements TogglyService {
    private _config;
    private _features;
    private _loadingFeatures;
    private _hookExecutor;
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
    requirement?: string;
    negate?: boolean;
    children: React__default.ReactNode;
};
declare class Feature extends React__default.Component<FeatureProps, {
    gate: string[];
    shouldShow: boolean;
}> {
    static contextType: React__default.Context<TogglyContext>;
    context: React__default.ContextType<typeof context>;
    constructor(props: FeatureProps);
    componentDidMount(): void;
    render(): React__default.ReactNode;
}

declare function createTogglyProvider(config: TogglyOptions): Promise<({ children }: {
    children: ReactNode;
}) => JSX.Element>;

export { Consumer, Feature, Provider, Toggly, TogglyContext, TogglyOptions, TogglyService, context, createTogglyProvider };
