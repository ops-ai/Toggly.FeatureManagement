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
 * Equality for audience, segment, and variant operands.
 * Non-strings do not match. They must not reach toLowerCase, which throws
 * into the caller's request (a numeric user id, or a null group slot).
 */
export function stringsEqual(
  a: unknown,
  b: unknown,
  ignoreCase: boolean,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false
  }
  return ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b
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
