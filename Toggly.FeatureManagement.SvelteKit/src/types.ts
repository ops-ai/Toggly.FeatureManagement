import type { EvaluatedDefinitions, TogglyEntityContext, TogglyEvaluationContext } from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from '@ops-ai/toggly-local-gates';
export type { EvaluatedDefinitions, TogglyEntityContext, TogglyEvaluationContext, LocalGate };
export interface TogglySnapshot {
  definitions: EvaluatedDefinitions;
  /** Explicitly public targeting data. Never put secrets or authentication claims here. */
  context: TogglyEvaluationContext;
  expose: string[];
}
export interface GateOptions {
  requirement?: 'all' | 'any';
  negate?: boolean;
  entity?: TogglyEntityContext;
  defaultValue?: boolean;
}
export interface BrowserOptions {
  /** Front-end App Key only. Backend keys belong in hooks.server.ts. */
  appKey?: string;
  environment?: string;
  baseURI?: string;
  allowedKeyIds?: string[];
  maxSignatureAgeSeconds?: number;
  refreshInterval?: number;
  /** Abort an unfinished definitions/JWKS request after this many ms (default 5000). */
  timeout?: number;
  enableLiveUpdates?: boolean;
  localGates?: LocalGate[];
  onError?: (message: string, error?: unknown) => void;
}
/** Copy only named fields; never serialize a service, backend config or raw server rules. */
export function selectDefinitions(definitions: EvaluatedDefinitions, expose: readonly string[]): EvaluatedDefinitions {
  return structuredClone(Object.fromEntries(expose.filter(key => Object.hasOwn(definitions, key)).map(key => [key, definitions[key]])));
}
