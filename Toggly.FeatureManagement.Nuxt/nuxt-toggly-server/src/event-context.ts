import type { H3Event } from 'h3'
import { getHeader, getRequestHeaders } from 'h3'
import { fromHttpRequest } from '@ops-ai/nuxt-toggly-core'
import type { FeatureCheckOptions } from './feature-check'
import type { EventEvalContextProviders } from './types'

const EVENT_CONTEXT_KEY = 'togglyEvalContext'

/** Module-level providers for event helpers (request-scoped values only). */
let eventProviders: EventEvalContextProviders = {}

/**
 * Register ambient EvalContext providers for Nuxt/Nitro event helpers.
 * Does not mutate process-global client identity — only extractor functions.
 */
export function configureEventEvalContext(
  providers: EventEvalContextProviders,
): void {
  eventProviders = { ...providers }
}

/**
 * Clear registered providers (tests / re-init).
 */
export function resetEventEvalContextProviders(): void {
  eventProviders = {}
}

/**
 * Current provider registration (shallow copy).
 */
export function getEventEvalContextProviders(): EventEvalContextProviders {
  return { ...eventProviders }
}

/** True when module-level providers were registered via `configureEventEvalContext`. */
export function hasConfiguredEventEvalProviders(
  providers?: EventEvalContextProviders,
): boolean {
  const config = { ...eventProviders, ...providers }
  return !!(
    config.getContext ||
    config.getIdentity ||
    config.getGroups ||
    config.getClaims
  )
}

type EventWithTogglyContext = H3Event & {
  context: H3Event['context'] & {
    [EVENT_CONTEXT_KEY]?: FeatureCheckOptions
  }
}

function eventBag(event: H3Event): EventWithTogglyContext {
  return event as EventWithTogglyContext
}

/**
 * Cached ambient options for an H3 event, if already resolved.
 */
export function getCachedEventEvalContext(
  event: H3Event,
): FeatureCheckOptions | undefined {
  return eventBag(event).context?.[EVENT_CONTEXT_KEY]
}

/**
 * Store ambient options on the event (request-scoped only).
 */
export function setCachedEventEvalContext(
  event: H3Event,
  options: FeatureCheckOptions,
): void {
  const ctx = eventBag(event)
  if (!ctx.context) {
    ctx.context = {} as EventWithTogglyContext['context']
  }
  ctx.context[EVENT_CONTEXT_KEY] = options
}

/**
 * Sync ambient from H3 headers + optional identity header (no async providers).
 * Used by `useEventToggly` when context has not been attached yet.
 */
export function syncDefaultEventAmbient(event: H3Event): FeatureCheckOptions {
  const headers = getRequestHeaders(event) as Record<
    string,
    string | string[] | undefined
  >
  const identity = getHeader(event, 'x-toggly-identity') || undefined
  const fromReq = fromHttpRequest(headers, { identity })
  return {
    identity: fromReq.identity,
    request: fromReq.request,
  }
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function'
  )
}

function resolveProvidersSync(
  event: H3Event,
  providers?: EventEvalContextProviders,
): FeatureCheckOptions | undefined {
  const config = { ...eventProviders, ...providers }
  const headers = getRequestHeaders(event) as Record<
    string,
    string | string[] | undefined
  >
  const headerRequest = fromHttpRequest(headers).request

  if (config.getContext) {
    const custom = config.getContext(event)
    if (isThenable(custom)) {
      return undefined
    }
    return {
      identity: custom.identity,
      groups: custom.groups,
      claims: custom.claims,
      request: {
        ...headerRequest,
        ...custom.request,
      },
      headers: custom.headers,
    }
  }

  if (!config.getIdentity && !config.getGroups && !config.getClaims) {
    return undefined
  }

  const identityResult = config.getIdentity
    ? config.getIdentity(event)
    : getHeader(event, 'x-toggly-identity') || undefined
  if (isThenable(identityResult)) {
    return undefined
  }
  const groupsResult = config.getGroups ? config.getGroups(event) : undefined
  if (isThenable(groupsResult)) {
    return undefined
  }
  const claimsResult = config.getClaims ? config.getClaims(event) : undefined
  if (isThenable(claimsResult)) {
    return undefined
  }

  const fromReq = fromHttpRequest(headers, {
    identity: identityResult,
    groups: groupsResult,
    claims: claimsResult,
  })
  return {
    identity: fromReq.identity,
    groups: fromReq.groups,
    claims: fromReq.claims,
    request: fromReq.request,
  }
}

/**
 * Resolve ambient EvalContext synchronously when providers return plain values.
 * Caches on the event when resolution succeeds. Async providers require
 * `resolveEventEvalContext` / `getEventToggly` instead.
 */
export function resolveSyncEventEvalContext(
  event: H3Event,
  providers?: EventEvalContextProviders,
): FeatureCheckOptions | undefined {
  const cached = getCachedEventEvalContext(event)
  if (cached) {
    return cached
  }

  const options = resolveProvidersSync(event, providers)
  if (!options) {
    return undefined
  }

  setCachedEventEvalContext(event, options)
  return options
}

/**
 * Resolve full ambient EvalContext for an H3 event.
 * Uses `getContext` when provided; otherwise getIdentity / getGroups / getClaims
 * (default identity: `x-toggly-identity`). Always fills missing `request` from
 * headers via `fromHttpRequest`. Caches on `event.context`.
 */
export async function resolveEventEvalContext(
  event: H3Event,
  providers?: EventEvalContextProviders,
): Promise<FeatureCheckOptions> {
  const cached = getCachedEventEvalContext(event)
  if (cached) {
    return cached
  }

  const config = { ...eventProviders, ...providers }
  const headers = getRequestHeaders(event) as Record<
    string,
    string | string[] | undefined
  >
  const headerRequest = fromHttpRequest(headers).request

  let options: FeatureCheckOptions

  if (config.getContext) {
    const custom = await config.getContext(event)
    options = {
      identity: custom.identity,
      groups: custom.groups,
      claims: custom.claims,
      // Field-merge: custom.request wins per field; headers fill gaps (Node OPS-887).
      request: {
        ...headerRequest,
        ...custom.request,
      },
      headers: custom.headers,
    }
  } else {
    const identity = config.getIdentity
      ? await config.getIdentity(event)
      : getHeader(event, 'x-toggly-identity') || undefined
    const groups = config.getGroups
      ? await config.getGroups(event)
      : undefined
    const claims = config.getClaims
      ? await config.getClaims(event)
      : undefined
    const fromReq = fromHttpRequest(headers, { identity, groups, claims })
    options = {
      identity: fromReq.identity,
      groups: fromReq.groups,
      claims: fromReq.claims,
      request: fromReq.request,
    }
  }

  setCachedEventEvalContext(event, options)
  return options
}
