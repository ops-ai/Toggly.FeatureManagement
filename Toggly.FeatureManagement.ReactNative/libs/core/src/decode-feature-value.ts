import type { FeatureValueType } from './models/variant.types';

/**
 * Soft-decodes resolved feature values by declared `valueType` (OPS-2102/OPS-2107).
 *
 * Mirrors `toggly-eval`'s `feature-value-codec.ts` semantics: never throws for
 * shape alone, never returns a wrong-typed value. A missing `declaredType`
 * (legacy catalogs) allows the decode attempt; a declared type that disagrees
 * with the requested getter soft-nulls.
 */

/** Prefer explicit catalog/evaluated `valueType`; soft-null on a getter/type disagreement. */
export function valueTypeMatches(
  declaredType: FeatureValueType | undefined,
  requestedType: FeatureValueType,
): boolean {
  if (declaredType == null || declaredType === ('' as FeatureValueType)) return true;
  return declaredType === requestedType;
}

/** Soft-decodes `raw` as a `string`. Null/mismatch/non-string → null. */
export function decodeStringValue(
  raw: unknown,
  declaredType: FeatureValueType | undefined,
): string | null {
  if (!valueTypeMatches(declaredType, 'string')) return null;
  return typeof raw === 'string' ? raw : null;
}

/** Soft-decodes `raw` as a `number`. Accepts numeric strings; null/mismatch → null. */
export function decodeNumberValue(
  raw: unknown,
  declaredType: FeatureValueType | undefined,
): number | null {
  if (!valueTypeMatches(declaredType, 'number')) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Soft-decodes `raw` as `T` when the declared type is `"json"`. Missing
 * value → null; with `isT`, null when the guard fails; otherwise `raw` as `T`.
 */
export function decodeJsonValue<T = unknown>(
  raw: unknown,
  declaredType: FeatureValueType | undefined,
  isT?: (value: unknown) => value is T,
): T | null {
  if (!valueTypeMatches(declaredType, 'json') || raw === null || raw === undefined) return null;
  if (isT) return isT(raw) ? raw : null;
  return raw as T;
}

/**
 * Soft-decodes `raw` as a `Date` from an ISO-8601 wire string, an existing
 * `Date`, or epoch milliseconds. Null/mismatch/unparseable → null.
 */
export function decodeDateTimeValue(
  raw: unknown,
  declaredType: FeatureValueType | undefined,
): Date | null {
  if (!valueTypeMatches(declaredType, 'datetime')) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
