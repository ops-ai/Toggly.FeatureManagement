/**
 * Shared helpers for /evaluated-variants-signed responses
 */

import type { EvaluatedVariantDef, Flags } from './types/index.js';

export function variantDefsToFlags(defs: Record<string, EvaluatedVariantDef>): Flags {
  const out: Flags = {};
  for (const key of Object.keys(defs)) {
    out[key] = defs[key]?.enabled === true;
  }
  return out;
}

export function parseVariantDefsPayload(payload: unknown): Record<string, EvaluatedVariantDef> {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const rawDefs = record.defs ?? payload;
  if (typeof rawDefs !== 'object' || rawDefs === null || Array.isArray(rawDefs)) {
    return {};
  }
  return rawDefs as Record<string, EvaluatedVariantDef>;
}
