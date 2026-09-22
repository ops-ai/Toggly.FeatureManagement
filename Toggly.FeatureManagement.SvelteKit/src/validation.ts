import type { EvaluatedDefinitions, EvaluatedVariantDef } from './types.js';

const operators = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const valueTypes = new Set(['datetime', 'number', 'boolean', 'string', 'string[]']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.property === 'string' &&
    typeof value.op === 'string' &&
    operators.has(value.op.toLowerCase()) &&
    typeof value.value === 'string' &&
    (value.type === undefined || (typeof value.type === 'string' && valueTypes.has(value.type)))
  );
}
function isDefinition(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    (isRecord(value) &&
      (value.requirement === 'all' || value.requirement === 'any') &&
      Array.isArray(value.rules) &&
      value.rules.every(isRule))
  );
}

/** Signatures authenticate bytes, not their schema. Reject the whole response
 * before allowlisting, publishing, or adopting its HTTP revision. Evaluation
 * remains owned by hooks-types; this only enforces its supported wire contract. */
export function validateEvaluatedDefinitions(
  value: unknown,
): asserts value is EvaluatedDefinitions {
  if (!isRecord(value) || !Object.values(value).every(isDefinition)) {
    throw new Error('Invalid evaluated definitions structure');
  }
}

function isVariantDefinition(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.enabled === 'boolean' &&
    (value.variant === undefined || typeof value.variant === 'string')
  );
}

/** Signatures authenticate bytes, not their schema; reject the whole `/evaluated-variants-signed`
 * response before allowlisting, publishing, or adopting its HTTP revision. */
export function validateVariantDefs(
  value: unknown,
): asserts value is Record<string, EvaluatedVariantDef> {
  if (!isRecord(value) || !Object.values(value).every(isVariantDefinition)) {
    throw new Error('Invalid evaluated variant definitions structure');
  }
}
