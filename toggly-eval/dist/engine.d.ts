import type { DefinitionsByKey, EvalContext, FeatureDefinitionModel, FilterEvaluator, GateRequirement } from './types';
/**
 * Evaluate a single feature definition against an evaluation context.
 * Missing / unknown filters are treated as false (IgnoreMissingFeatureFilters).
 */
export declare function evaluateDefinition(def: FeatureDefinitionModel, ctx?: EvalContext, registry?: Map<string, FilterEvaluator>): boolean;
/**
 * Look up a definition by key and evaluate it. Unknown keys → false.
 */
export declare function evaluateDefinitions(defsByKey: DefinitionsByKey, featureKey: string, ctx?: EvalContext, registry?: Map<string, FilterEvaluator>): boolean;
/**
 * Evaluate multiple feature keys with any/all + optional negate.
 */
export declare function evaluateFeatureGate(defsByKey: DefinitionsByKey, featureKeys: string[], requirement?: GateRequirement, negate?: boolean, ctx?: EvalContext, registry?: Map<string, FilterEvaluator>): boolean;
/**
 * Index a definitions-signed array by featureKey.
 */
export declare function indexDefinitions(definitions: FeatureDefinitionModel[] | null | undefined): Map<string, FeatureDefinitionModel>;
/**
 * Parse a definitions payload (array or signed envelope defs) into a map.
 */
export declare function parseDefinitionsPayload(raw: unknown): Map<string, FeatureDefinitionModel>;
/**
 * Snapshot evaluated booleans for all known keys (entity gates fail closed
 * without entity context). Useful for hydration helpers.
 */
export declare function snapshotEvaluatedBooleans(defsByKey: DefinitionsByKey, ctx?: EvalContext): Record<string, boolean>;
