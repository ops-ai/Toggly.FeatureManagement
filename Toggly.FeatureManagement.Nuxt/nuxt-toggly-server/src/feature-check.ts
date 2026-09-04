import {
  fromHttpRequest,
  type EvalContext,
  type EvalContextArg,
  type EvalContextOverrides,
} from '@ops-ai/nuxt-toggly-core'

/**
 * Per-call evaluation options for Nuxt server helpers.
 */
export interface FeatureCheckOptions {
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  request?: NonNullable<EvalContext['request']>
  headers?: Headers | Record<string, string | string[] | undefined>
}

export function resolveFeatureCheckArgs(
  identityOrOptions?: string | FeatureCheckOptions,
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
 * Map FeatureCheckOptions into core EvalContext overrides.
 * When `headers` is set, maps via `fromHttpRequest`; explicit `request` fields win.
 */
export function toEvalOverrides(
  options: FeatureCheckOptions,
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
