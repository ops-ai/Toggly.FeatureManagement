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
export declare function isEvaluatedDefinitions(value: unknown): value is EvaluatedDefinitions;
export declare function isEntityGate(value: unknown): value is EntityGate;
