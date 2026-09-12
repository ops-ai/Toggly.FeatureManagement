import type { EvaluatedDefinitions, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';

/** Server-produced public data. Never put backend definitions or a client instance here. */
export interface TogglySnapshot {
  definitions: EvaluatedDefinitions;
  context: TogglyEvaluationContext;
  expose: string[];
  source: 'signed' | 'defaults';
}
const operators = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);
const valueTypes = new Set(['datetime', 'number', 'boolean', 'string', 'string[]']);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The shared transport checks signatures; validate the complete entity schema here
 * before projection or state/revision advancement. Evaluation stays in shared core. */
function isCompleteDefinitions(value: unknown): value is EvaluatedDefinitions {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (definition) =>
        typeof definition === 'boolean' ||
        (isRecord(definition) &&
          (definition.requirement === 'all' || definition.requirement === 'any') &&
          Array.isArray(definition.rules) &&
          definition.rules.every(
            (rule) =>
              isRecord(rule) &&
              typeof rule.property === 'string' &&
              typeof rule.op === 'string' &&
              operators.has(rule.op.toLowerCase()) &&
              typeof rule.value === 'string' &&
              (rule.type === undefined ||
                (typeof rule.type === 'string' && valueTypes.has(rule.type))),
          )),
    )
  );
}
/** Select public keys without changing the shared entity-gate evaluator. */
export function selectDefinitions(
  definitions: unknown,
  expose?: readonly string[],
): EvaluatedDefinitions {
  if (!isCompleteDefinitions(definitions)) throw new Error('Invalid evaluated definitions');
  const keys = expose ?? Object.keys(definitions);
  return structuredClone(
    Object.fromEntries(
      keys.filter((key) => Object.hasOwn(definitions, key)).map((key) => [key, definitions[key]]),
    ),
  );
}
export function publicContext(context: TogglyEvaluationContext = {}): TogglyEvaluationContext {
  return structuredClone({
    identity: context.identity,
    groups: context.groups,
    claims: context.claims,
  });
}
