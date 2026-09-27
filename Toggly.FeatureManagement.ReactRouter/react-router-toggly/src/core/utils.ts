/**
 * Utility functions for Toggly React Router SDK
 */

import type {
  FeatureFlags,
  FeatureRequirement,
  EvaluationResult,
  TogglyConfig,
  EvaluatedVariantDef,
} from './types';
import {
  appendEvaluationContext,
  clearRegisteredContexts,
  evaluateEvaluatedGate,
  normalizeEntityContext,
  registerContext,
  resolveEvaluatedDefinition,
  type TogglyEvaluationContext,
  type TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types';
import {
  evaluateDefinitions,
  evaluateFeatureGate as evaluateLocalFeatureGate,
  type DefinitionsByKey,
  type EvalContext,
} from '@ops-ai/toggly-eval';
import { asVariantDefsRecord, unwrapDefsPayload } from '@ops-ai/toggly-signed-defs';

/**
 * Default Toggly configuration
 */
export const DEFAULT_CONFIG: Required<
  Pick<TogglyConfig, 'baseUrl' | 'environment' | 'timeout' | 'debug' | 'evaluationMode'>
> = {
  baseUrl: 'https://definitions.toggly.io',
  environment: 'Production',
  timeout: 10000,
  debug: false,
  evaluationMode: 'remote',
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(config: TogglyConfig): TogglyConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

/**
 * Build the feature definitions URL.
 *
 * - `evaluationMode: 'remote'` (default): `/evaluated-signed/...` + context query params
 * - `evaluationMode: 'local'`: `/definitions-signed/...` with no evaluation context params
 * - `enableVariants: true` (remote only): `/evaluated-variants-signed/...` instead of
 *   `/evaluated-signed/...`; identity is sent as `userId` rather than `u` (worker contract).
 */
export function buildDefinitionsUrl(
  config: TogglyConfig,
  context?: string | TogglyEvaluationContext
): string {
  const { baseUrl, appKey, environment, groups, claims, evaluationMode, enableVariants } =
    mergeConfig(config);

  if (!appKey) {
    throw new Error('appKey is required');
  }

  const mode = evaluationMode ?? 'remote';
  const useVariants = mode !== 'local' && enableVariants === true;
  let pathSegment = 'evaluated-signed';
  if (mode === 'local') {
    pathSegment = 'definitions-signed';
  } else if (useVariants) {
    pathSegment = 'evaluated-variants-signed';
  }
  const url = new URL(`${baseUrl}/${pathSegment}/${appKey}/${environment}`);

  if (mode === 'local') {
    return url.toString();
  }

  const fromParam =
    typeof context === 'string' ? { identity: context } : context;

  appendEvaluationContext(
    url,
    {
      identity: fromParam?.identity,
      groups: fromParam?.groups ?? groups,
      claims: fromParam?.claims ?? claims,
    },
    useVariants ? 'variants' : 'evaluated',
  );

  return url.toString();
}

/**
 * Parse an evaluated-variants-signed HTTP body into a variant defs record.
 * Unwraps a `{ defs }` envelope (unverified path) or accepts an already-unwrapped
 * verified payload; rejects error envelopes; coerces non-map shapes (arrays,
 * primitives) to `{}`.
 */
export function parseVariantDefsPayload(
  parsed: unknown,
): Record<string, EvaluatedVariantDef> {
  return asVariantDefsRecord<EvaluatedVariantDef>(unwrapDefsPayload(parsed));
}

/** Derive a boolean feature map from evaluated variant defs. */
export function variantDefsToFlags(
  defs: Record<string, EvaluatedVariantDef>,
): FeatureFlags {
  const out: FeatureFlags = {};
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true;
  }
  return out;
}

/**
 * Soft-decode a variant configuration value as `T`.
 * Missing/null -> null; with `isT` -> null when guard fails; otherwise value as T.
 */
export function decodeVariantValue<T = unknown>(
  value: unknown,
  isT?: (v: unknown) => v is T,
): T | null {
  if (value === null || value === undefined) return null;
  if (isT) return isT(value) ? value : null;
  return value as T;
}

/**
 * Evaluate a single feature
 */
export function isFeatureEnabled(
  flags: FeatureFlags,
  featureKey: string,
  defaultValue = false,
  entityContext?: TogglyEntityContext | null,
): boolean {
  if (!flags || Object.keys(flags).length === 0) {
    return defaultValue;
  }

  const value = flags[featureKey];
  if (value === undefined) {
    return defaultValue;
  }

  return resolveEvaluatedDefinition(value, entityContext);
}

export { registerContext, clearRegisteredContexts, normalizeEntityContext };

/**
 * Locally evaluate a single feature against definitions-signed rules.
 */
export function isFeatureEnabledLocal(
  defsByKey: DefinitionsByKey | null | undefined,
  featureKey: string,
  evalCtx: EvalContext = {},
  defaultValue = false,
): boolean {
  if (!defsByKey || defsByKey.size === 0) {
    return defaultValue;
  }

  if (!defsByKey.has(featureKey)) {
    return defaultValue;
  }

  return evaluateDefinitions(defsByKey, featureKey, evalCtx);
}

/**
 * Locally evaluate multiple features with requirement against definitions-signed rules.
 */
export function evaluateFeatureGateLocal(
  defsByKey: DefinitionsByKey | null | undefined,
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate = false,
  defaultValue = false,
  evalCtx: EvalContext = {},
): EvaluationResult {
  if (!defsByKey || defsByKey.size === 0) {
    return {
      enabled: negate ? !defaultValue : defaultValue,
      featureKeys,
      requirement,
      negated: negate,
    };
  }

  if (featureKeys.length === 0) {
    return {
      enabled: negate ? false : true,
      featureKeys,
      requirement,
      negated: negate,
    };
  }

  const enabled = evaluateLocalFeatureGate(
    defsByKey,
    featureKeys,
    requirement,
    negate,
    evalCtx,
  );

  return {
    enabled,
    featureKeys,
    requirement,
    negated: negate,
  };
}

/**
 * Evaluate multiple features with requirement
 */
export function evaluateFeatureGate(
  flags: FeatureFlags,
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate = false,
  defaultValue = false,
  entityContext?: TogglyEntityContext | null,
): EvaluationResult {
  if (!flags || Object.keys(flags).length === 0) {
    return {
      enabled: negate ? !defaultValue : defaultValue,
      featureKeys,
      requirement,
      negated: negate,
    };
  }

  if (featureKeys.length === 0) {
    return {
      enabled: negate ? false : true,
      featureKeys,
      requirement,
      negated: negate,
    };
  }

  const enabled = evaluateEvaluatedGate(
    flags,
    featureKeys,
    requirement,
    negate,
    entityContext,
  );

  return {
    enabled,
    featureKeys,
    requirement,
    negated: negate,
  };
}

/**
 * Normalize feature keys from options
 */
export function normalizeFeatureKeys(
  featureKey?: string,
  featureKeys?: string[]
): string[] {
  const keys: string[] = [];

  if (featureKey) {
    keys.push(featureKey);
  }

  if (featureKeys && Array.isArray(featureKeys)) {
    keys.push(...featureKeys);
  }

  return [...new Set(keys)]; // Remove duplicates
}

/**
 * Create a debug logger
 */
export function createLogger(debug: boolean) {
  return {
    debug: (...args: unknown[]) => {
      if (debug) {
        console.debug('[Toggly]', ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (debug) {
        console.info('[Toggly]', ...args);
      }
    },
    warn: (...args: unknown[]) => {
      console.warn('[Toggly]', ...args);
    },
    error: (...args: unknown[]) => {
      console.error('[Toggly]', ...args);
    },
  };
}

/**
 * Parse identity from various sources (cookie value, header, etc.)
 */
export function parseIdentity(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  // Try to parse as JSON (in case it's a stringified object)
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      // Look for common identity fields
      return parsed.identity || parsed.id || parsed.userId || parsed.sub;
    }
  } catch {
    // Not JSON, use as-is
  }

  return value;
}

/**
 * Serialize feature flags for transport
 */
export function serializeFlags(flags: FeatureFlags): string {
  return JSON.stringify(flags);
}

/**
 * Deserialize feature flags from transport
 */
export function deserializeFlags(value: string | null | undefined): FeatureFlags {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as FeatureFlags;
    }
  } catch {
    // Invalid JSON
  }

  return {};
}

/**
 * Check if we're running on the server
 */
export function isServer(): boolean {
  return !isClient();
}

/**
 * Check if we're running on the client
 */
export function isClient(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
  );
}

/**
 * Create a timeout promise
 */
export function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);
  });
}

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
