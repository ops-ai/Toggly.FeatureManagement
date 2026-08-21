export interface EntityGateRule {
    property: string;
    op: string;
    value: string;
    type?: 'datetime' | 'number' | 'boolean' | 'string' | 'string[]';
}
export interface EntityGate {
    requirement: 'all' | 'any';
    rules: EntityGateRule[];
}
export type EvaluatedDefinitionValue = boolean | EntityGate;
export type EvaluatedDefinitions = Record<string, EvaluatedDefinitionValue>;
export interface TogglyEntityContext {
    kind: string;
    key: string;
    attributes: Record<string, unknown>;
}
export type EntityContextMapper<T = unknown> = (entity: T) => TogglyEntityContext;
export declare function isEntityGate(value: unknown): value is EntityGate;
/**
 * Resolves one evaluated definition to a boolean.
 *
 * An absent definition falls back to `defaultValue`; an entity gate without a
 * context always fails closed, so a default can never enable a gated feature.
 */
export declare function resolveEvaluatedDefinition(value: EvaluatedDefinitionValue | undefined, context?: TogglyEntityContext | null, defaultValue?: boolean): boolean;
/**
 * Flattens mixed definitions to plain booleans for consumers that cannot carry
 * entity gates (hook payloads, cached snapshots, legacy flag maps).
 */
export declare function toBooleanDefinitions(definitions: EvaluatedDefinitions, context?: TogglyEntityContext | null): Record<string, boolean>;
export declare function applyEntityGate(gate: EntityGate, attributes: Record<string, unknown>): boolean;
export declare function registerContext<T>(kind: string, mapper: EntityContextMapper<T>): void;
export declare function resolveEntityContext<T>(kind: string, entity: T): TogglyEntityContext | null;
export declare function mapEntityContext<T>(kind: string, entity: T, mapper?: EntityContextMapper<T>): TogglyEntityContext | null;
export declare function clearRegisteredContexts(): void;
export declare function normalizeEntityContext(context?: TogglyEntityContext | Record<string, unknown> | null, kind?: string): TogglyEntityContext | null;
export type EvaluatedGateRequirement = 'all' | 'any';
export declare function evaluateResolvedKeys(featureKeys: string[], requirement: EvaluatedGateRequirement, negate: boolean, isEnabled: (key: string) => boolean): boolean;
/**
 * Client-SDK gate evaluation over stored mixed defs. An empty definition
 * set fails closed (`negate`) so a missing payload cannot open a gate.
 */
export declare function evaluateStoredFeatureKeys(features: EvaluatedDefinitions | null | undefined, featureKeys: string[], requirement: EvaluatedGateRequirement, negate: boolean, isEnabled: (key: string) => boolean): boolean;
export declare function evaluateEvaluatedGate(features: EvaluatedDefinitions, featureKeys: string[], requirement?: EvaluatedGateRequirement, negate?: boolean, entityContext?: TogglyEntityContext | null): boolean;
