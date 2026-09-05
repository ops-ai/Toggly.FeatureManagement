import { createHash } from 'node:crypto'
import {
  fromHttpRequest,
  type EvalContext,
  type EvalContextArg,
  type EvalContextOverrides,
  type TogglyEntityContext,
} from '@ops-ai/nextjs-toggly-core'
import {
  getAmbientEvalOverrides,
  mergeFeatureCheckOptions,
} from './eval-context-store'

/** Domain object or already-normalized entity context for Context Property filters. */
export type EntityContextInput =
  | TogglyEntityContext
  | Record<string, unknown>
  | null
  | undefined

/**
 * Per-call evaluation options for server helpers.
 * `identity` is user targeting; `context` / `contextKind` are entity gates.
 * `groups` / `claims` / `request` / `headers` feed local EvalContext.
 */
export interface FeatureCheckOptions {
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  request?: NonNullable<EvalContext['request']>
  headers?: Headers | Record<string, string | string[] | undefined>
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

/**
 * Resolve per-call args and merge ambient EvalContext (per-call wins field-by-field).
 */
export function resolveFeatureCheckWithAmbient(
  identityOrOptions?: string | FeatureCheckOptions
): FeatureCheckOptions {
  return mergeFeatureCheckOptions(
    getAmbientEvalOverrides(),
    resolveFeatureCheckArgs(identityOrOptions)
  )
}

/**
 * Map FeatureCheckOptions into core EvalContext overrides.
 * When `headers` is set, maps via `fromHttpRequest`; explicit `request` fields win.
 */
export function toEvalOverrides(
  options: FeatureCheckOptions
): EvalContextArg | undefined {
  const { identity, groups, claims, request, headers } = options

  let resolvedRequest = request
  if (headers != null) {
    const fromReq = fromHttpRequest(headers, { identity, groups, claims })
    resolvedRequest = {
      ...fromReq.request,
      ...request,
    }
  }

  if (
    identity == null &&
    groups == null &&
    claims == null &&
    resolvedRequest == null
  ) {
    return undefined
  }

  // Preserve bare-string path for identity-only callers of core.
  if (
    identity != null &&
    groups == null &&
    claims == null &&
    resolvedRequest == null
  ) {
    return identity
  }

  const overrides: EvalContextOverrides = {}
  if (identity != null) overrides.identity = identity
  if (groups != null) overrides.groups = groups
  if (claims != null) overrides.claims = claims
  if (resolvedRequest != null) overrides.request = resolvedRequest
  return overrides
}

function stableSerialize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(stableSerialize)
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = stableSerialize(obj[key])
  }
  return out
}

function hasHashedEvalFields(options: FeatureCheckOptions): boolean {
  return (
    options.context != null ||
    options.contextKind != null ||
    options.groups != null ||
    options.claims != null ||
    options.request != null ||
    options.headers != null
  )
}

/**
 * Cache key for a feature check.
 * Identity-only keys keep the historical `toggly:feature:{key}:{identity}` shape.
 * Entity context and eval overrides are hashed so attributes distinguish entries.
 */
export function createFeatureCacheKey(
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions
): string {
  const options = resolveFeatureCheckArgs(identityOrOptions)
  const { identity, context, contextKind, groups, claims } = options
  const base = `toggly:feature:${featureKey}`

  if (!hasHashedEvalFields(options)) {
    return identity ? `${base}:${identity}` : base
  }

  const overrides = toEvalOverrides(options)
  const resolvedRequest =
    typeof overrides === 'object' && overrides != null
      ? overrides.request
      : undefined

  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        i: identity ?? '',
        k: contextKind ?? '',
        c: stableSerialize(context ?? null),
        g: groups ? [...groups].sort((a, b) => a.localeCompare(b)) : null,
        cl: stableSerialize(claims ?? null),
        r: stableSerialize(resolvedRequest ?? null),
      })
    )
    .digest('hex')
    .slice(0, 16)
  return `${base}:${digest}`
}
