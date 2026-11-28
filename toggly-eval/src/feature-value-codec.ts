/**
 * Soft-decode resolved feature values by declared FeatureValueType (OPS-2102).
 * Never throws for shape alone; never returns a wrong-typed value.
 */

export type FeatureValueType = 'boolean' | 'string' | 'number' | 'json' | 'datetime'

export function isFeatureValueType(value: unknown): value is FeatureValueType {
  return (
    value === 'boolean' ||
    value === 'string' ||
    value === 'number' ||
    value === 'json' ||
    value === 'datetime'
  )
}

/** Prefer explicit catalog/evaluated valueType; soft-null when getter mismatches. */
export function valueTypeMatches(
  declared: FeatureValueType | undefined | null,
  requested: FeatureValueType,
): boolean {
  if (declared == null) {
    // Legacy catalogs without valueType: allow decode attempt (soft-null on failure).
    return true
  }
  return declared === requested
}

export function decodeStringValue(
  raw: unknown,
  declared?: FeatureValueType | null,
): string | null {
  if (!valueTypeMatches(declared, 'string')) return null
  if (typeof raw === 'string') return raw
  return null
}

export function decodeNumberValue(
  raw: unknown,
  declared?: FeatureValueType | null,
): number | null {
  if (!valueTypeMatches(declared, 'number')) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function decodeJsonValue(
  raw: unknown,
  declared?: FeatureValueType | null,
): unknown | null {
  if (!valueTypeMatches(declared, 'json')) return null
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed !== null && typeof parsed === 'object') return parsed
    } catch {
      return null
    }
  }
  return null
}

/** ISO-8601 wire → Date; soft-null on failure. */
export function decodeDateTimeValue(
  raw: unknown,
  declared?: FeatureValueType | null,
): Date | null {
  if (!valueTypeMatches(declared, 'datetime')) return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export interface ResolvedFeatureValueSource {
  enabled: boolean
  valueType?: FeatureValueType | null
  /** Prefer `value`, else `configurationValue`. */
  value?: unknown
  configurationValue?: unknown
}

export function rawResolvedValue(source: ResolvedFeatureValueSource): unknown {
  if (source.value !== undefined) return source.value
  return source.configurationValue
}
