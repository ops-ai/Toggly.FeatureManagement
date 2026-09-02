/**
 * Types mirroring Go `toggly/definitions` for definitions-signed payloads.
 */
export type RequirementType = 'Any' | 'All' | string;
export interface FeatureFilter {
    name: string;
    parameters?: Record<string, unknown>;
}
export interface FeatureDefinitionModel {
    featureKey: string;
    filters?: FeatureFilter[];
    metrics?: string[];
    securedFeature?: boolean;
    clientSdkEnabled?: boolean;
    requirementType?: RequirementType;
    contextKind?: string;
    contextRequirementType?: RequirementType;
}
/** Entity instance for ContextProperty evaluation. */
export interface EntityEvalContext {
    kind: string;
    key: string;
    attributes?: Record<string, unknown>;
}
/** Evaluation context for local definition evaluation. */
export interface EvalContext {
    identity?: string;
    groups?: string[];
    /** Custom attributes / claims used by Targeting and similar filters. */
    traits?: Record<string, unknown>;
    entity?: EntityEvalContext | null;
}
export type GateRequirement = 'all' | 'any';
export type DefinitionsByKey = ReadonlyMap<string, FeatureDefinitionModel>;
export type FilterEvaluator = (featureKey: string, params: Record<string, unknown> | undefined, ctx: EvalContext) => boolean;
