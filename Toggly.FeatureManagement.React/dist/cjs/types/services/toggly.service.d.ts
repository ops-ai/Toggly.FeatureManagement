export interface TogglyOptions {
    baseURI?: string;
    appKey?: string;
    environment?: string;
    identity?: string;
    featureDefaults?: {
        [key: string]: boolean;
    };
    showFeatureDuringEvaluation?: boolean;
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
}
export declare class Toggly implements TogglyService {
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
export default Toggly;
