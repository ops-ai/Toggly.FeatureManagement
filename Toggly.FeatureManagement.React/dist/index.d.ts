/// <reference types="react" />
import * as React from 'react';
import React__default, { ReactNode } from 'react';

interface TogglyOptions {
    baseURI?: string;
    appKey?: string;
    environment?: string;
    identity?: string;
    featureDefaults?: {
        [key: string]: boolean;
    };
    showFeatureDuringEvaluation?: boolean;
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
    shouldShowFeatureDuringEvaluation: boolean;
    constructor(config: TogglyOptions);
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
