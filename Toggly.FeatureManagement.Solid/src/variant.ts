import { asVariantDefsRecord } from '@ops-ai/toggly-signed-defs';
import type { EvaluatedDefinitions } from '@ops-ai/toggly-hooks-types';

/** Assigned variant for a feature (aligned with @ops-ai/feature-flags-toggly). */
export interface VariantResult {
  name: string;
  configurationValue?: unknown;
}

/** Raw evaluated entry from `/evaluated-variants-signed` `defs`. */
export interface EvaluatedVariantDef {
  enabled: boolean;
  variant?: string;
  configurationValue?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCompleteVariantDefinitions(
  value: Record<string, unknown>,
): value is Record<string, EvaluatedVariantDef> {
  return Object.values(value).every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.enabled === 'boolean' &&
      (entry.variant === undefined || typeof entry.variant === 'string'),
  );
}

/**
 * Coerce and select public keys from a verified `/evaluated-variants-signed` payload.
 * Validates the complete entry schema here, matching {@link selectDefinitions}'s guard,
 * before projection or state/revision advancement.
 */
export function selectVariantDefinitions(
  definitions: unknown,
  expose?: readonly string[],
): Record<string, EvaluatedVariantDef> {
  const record = asVariantDefsRecord<unknown>(definitions);
  if (!isCompleteVariantDefinitions(record))
    throw new Error('Invalid evaluated variant definitions');
  const keys = expose ?? Object.keys(record);
  return structuredClone(
    Object.fromEntries(
      keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]),
    ),
  );
}

/** Derive boolean flags from variant defs for the shared evaluate()/local-gate flows. */
export function variantDefsToFlags(
  defs: Record<string, EvaluatedVariantDef>,
): EvaluatedDefinitions {
  const out: EvaluatedDefinitions = {};
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true;
  }
  return out;
}
