import { isEvaluatedDefinitions } from '@ops-ai/toggly-signed-defs';
import type { EvaluatedDefinitions, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';

/** Server-produced public data. Never put backend definitions or a client instance here. */
export interface TogglySnapshot {
  definitions: EvaluatedDefinitions;
  context: TogglyEvaluationContext;
  expose: string[];
  source: 'signed' | 'defaults';
}
/** Select public keys without changing the shared entity-gate evaluator. */
export function selectDefinitions(definitions: EvaluatedDefinitions, expose?: readonly string[]): EvaluatedDefinitions {
  if (!isEvaluatedDefinitions(definitions)) throw new Error('Invalid evaluated definitions');
  const keys = expose ?? Object.keys(definitions);
  return structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(definitions, key)).map(key => [key, definitions[key]])));
}
export function publicContext(context: TogglyEvaluationContext = {}): TogglyEvaluationContext {
  return structuredClone({ identity: context.identity, groups: context.groups, claims: context.claims });
}
