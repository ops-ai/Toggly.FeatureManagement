/** Shared parameter helpers for filter evaluators (avoids circular imports). */

export function asFloat(
  params: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!params) {
    return undefined
  }
  const v = params[key]
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string') {
    const f = Number.parseFloat(v)
    return Number.isFinite(f) ? f : undefined
  }
  return undefined
}

export function asBool(
  params: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  if (!params) {
    return undefined
  }
  const v = params[key]
  if (typeof v === 'boolean') {
    return v
  }
  if (typeof v === 'string') {
    if (v === 'true' || v === 'True' || v === '1') {
      return true
    }
    if (v === 'false' || v === 'False' || v === '0') {
      return false
    }
  }
  return undefined
}

export function asString(
  params: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!params) {
    return undefined
  }
  const v = params[key]
  return typeof v === 'string' ? v : undefined
}

function asStringValue(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * Coerce audience identity / group values the way .NET treats string
 * identity: finite numbers and bigints become their decimal text; null and
 * undefined are skipped; objects, booleans, and non-finite numbers cannot
 * be coerced consistently and stay undefined.
 */
export function coerceAudienceString(v: unknown): string | undefined {
  if (v == null) {
    return undefined
  }
  if (typeof v === 'string') {
    return v
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : undefined
  }
  if (typeof v === 'bigint') {
    return String(v)
  }
  return undefined
}

/**
 * Equality for audience, segment, and variant operands.
 * Finite numbers and bigints coerce to decimal text (matching .NET string
 * identity). Other non-strings do not match and must not reach toLowerCase,
 * which throws into the caller's request (a null group slot, an object id).
 */
export function stringsEqual(
  a: unknown,
  b: unknown,
  ignoreCase: boolean,
): boolean {
  const left = coerceAudienceString(a)
  const right = coerceAudienceString(b)
  if (left === undefined || right === undefined) {
    return false
  }
  return ignoreCase ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Collect indexed RavenDB / legacy colon-prefixed parameter values. */
export function collectIndexedValues(
  params: Record<string, unknown> | undefined,
  prefixes: string[],
): string[] {
  if (!params) {
    return []
  }
  const out: string[] = []
  for (const key of Object.keys(params)) {
    for (const prefix of prefixes) {
      if (!key.startsWith(`${prefix}:`)) {
        continue
      }
      const s = asStringValue(params[key])
      if (s) {
        out.push(s)
      }
      break
    }
  }
  return out
}
