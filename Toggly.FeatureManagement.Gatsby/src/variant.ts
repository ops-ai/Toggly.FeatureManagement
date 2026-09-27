/**
 * Helpers for `/evaluated-variants-signed` payloads (opt-in `enableVariants`).
 * Mirrors the Solid/Astro SDKs' variant parsing so all client and server
 * rails agree on the wire shape.
 */

import { asVariantDefsRecord } from '@ops-ai/toggly-signed-defs';
import type { EvaluatedDefinitions } from '@ops-ai/toggly-hooks-types';
import type { EvaluatedVariantDef } from './types/index.js';

export type { VariantResult, EvaluatedVariantDef } from './types/index.js';

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
 * Coerce and validate an unwrapped `/evaluated-variants-signed` `defs` payload.
 * Throws on a malformed entry so callers can fall back the same way an
 * invalid `/evaluated-signed` body does today.
 */
export function parseVariantDefinitions(
  definitions: unknown,
): Record<string, EvaluatedVariantDef> {
  const record = asVariantDefsRecord<unknown>(definitions);
  if (!isCompleteVariantDefinitions(record)) {
    throw new Error('Invalid evaluated variant definitions');
  }
  return structuredClone(record);
}

/** Derive boolean flags from variant defs for boolean-flag consumers (getFlag/evaluateGate/hooks). */
export function variantDefsToFlags(
  defs: Record<string, EvaluatedVariantDef>,
): EvaluatedDefinitions {
  const out: EvaluatedDefinitions = {};
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true;
  }
  return out;
}
