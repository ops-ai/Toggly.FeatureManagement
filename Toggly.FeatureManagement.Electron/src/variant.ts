import { asVariantDefsRecord } from '@ops-ai/toggly-signed-defs'
import type { EvaluatedDefinitions } from '@ops-ai/toggly-hooks-types'

/** Assigned variant for a feature (aligned with @ops-ai/feature-flags-toggly). */
export interface VariantResult {
  name: string
  configurationValue?: unknown
}

/** Raw evaluated entry from `/evaluated-variants-signed` `defs`. */
export interface EvaluatedVariantDef {
  enabled: boolean
  variant?: string
  configurationValue?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate a parsed/cached body is a complete evaluated-variants defs map. */
export function isValidVariantDefinitions(
  value: unknown,
): value is Record<string, EvaluatedVariantDef> {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.enabled === 'boolean' &&
      (entry.variant === undefined || typeof entry.variant === 'string'),
  )
}

/**
 * Coerce and validate an `/evaluated-variants-signed` `defs` payload.
 * Throws when the shape does not match the expected entry schema, matching
 * the strictness of the boolean `isValidDefinitions` guard in `cache.ts`.
 */
export function parseVariantDefinitions(
  parsedDefs: unknown,
): Record<string, EvaluatedVariantDef> {
  const record = asVariantDefsRecord<unknown>(parsedDefs)
  if (!isValidVariantDefinitions(record)) {
    throw new Error('Invalid evaluated variant definitions')
  }
  return record
}

/** Derive boolean flags from variant defs for gate evaluation and caching. */
export function variantDefsToFlags(
  defs: Record<string, EvaluatedVariantDef>,
): EvaluatedDefinitions {
  const out: EvaluatedDefinitions = {}
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true
  }
  return out
}
