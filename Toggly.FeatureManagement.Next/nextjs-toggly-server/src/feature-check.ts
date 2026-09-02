import { createHash } from 'node:crypto'
import type { TogglyEntityContext } from '@ops-ai/nextjs-toggly-core'

/** Domain object or already-normalized entity context for Context Property filters. */
export type EntityContextInput =
  | TogglyEntityContext
  | Record<string, unknown>
  | null
  | undefined

/**
 * Per-call evaluation options for server helpers.
 * `identity` is user targeting; `context` / `contextKind` are entity gates.
 */
export interface FeatureCheckOptions {
  identity?: string
  context?: EntityContextInput
  contextKind?: string
}

export function resolveFeatureCheckArgs(
  identityOrOptions?: string | FeatureCheckOptions
): FeatureCheckOptions {
  if (identityOrOptions == null) {
    return {}
  }
  if (typeof identityOrOptions === 'string') {
    return { identity: identityOrOptions }
  }
  return identityOrOptions
}

function stableSerialize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(stableSerialize)
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = stableSerialize(obj[key])
  }
  return out
}

/**
 * Cache key for a feature check.
 * Identity-only keys keep the historical `toggly:feature:{key}:{identity}` shape.
 * Entity context is hashed so attributes (not just kind+key) distinguish entries
 * and values cannot forge another key via delimiters.
 */
export function createFeatureCacheKey(
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions
): string {
  const { identity, context, contextKind } =
    resolveFeatureCheckArgs(identityOrOptions)
  const base = `toggly:feature:${featureKey}`
  if (context == null && contextKind == null) {
    return identity ? `${base}:${identity}` : base
  }
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        i: identity ?? '',
        k: contextKind ?? '',
        c: stableSerialize(context ?? null),
      })
    )
    .digest('hex')
    .slice(0, 16)
  return `${base}:${digest}`
}
