import type { H3Event, EventHandler } from 'h3'
import { createError, defineEventHandler } from 'h3'
import { normalizeFeatureKeys } from '@ops-ai/nuxt-toggly-core'
import type { TogglyClient } from '@ops-ai/nuxt-toggly-core'
import type { EvalContextArg } from '@ops-ai/nuxt-toggly-core'
import {
  mergeEvalArg,
  mergeFeatureCheckOptions,
  resolveFeatureCheckArgs,
  toEvalOverrides,
  type FeatureCheckOptions,
} from './feature-check'
import {
  getCachedEventEvalContext,
  resolveEventEvalContext,
  syncDefaultEventAmbient,
} from './event-context'
import type {
  EventEvalContextProviders,
  FeatureMiddlewareOptions,
} from './types'
import { getServerToggly, useServerToggly } from './server-client'

/**
 * Request-scoped view of the shared server client that binds ambient
 * EvalContext without mutating process-wide `client.identity`.
 */
function bindEventEvalContext(
  client: TogglyClient,
  ambient: FeatureCheckOptions,
): TogglyClient {
  const hasAmbient =
    ambient.identity != null ||
    ambient.groups != null ||
    ambient.claims != null ||
    ambient.request != null ||
    ambient.headers != null

  if (!hasAmbient) {
    return client
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'identity') {
        return ambient.identity ?? target.identity
      }
      if (prop === 'isFeatureOn') {
        return (
          featureKey: string,
          context?: Parameters<TogglyClient['isFeatureOn']>[1],
          kind?: string,
          overrides?: EvalContextArg,
        ) =>
          target.isFeatureOn(
            featureKey,
            context,
            kind,
            mergeEvalArg(ambient, overrides),
          )
      }
      if (prop === 'isFeatureOff') {
        return (
          featureKey: string,
          context?: Parameters<TogglyClient['isFeatureOff']>[1],
          kind?: string,
          overrides?: EvalContextArg,
        ) =>
          target.isFeatureOff(
            featureKey,
            context,
            kind,
            mergeEvalArg(ambient, overrides),
          )
      }
      if (prop === 'evaluateFeatureGate') {
        return (
          featureKeys: string[],
          requirement?: Parameters<TogglyClient['evaluateFeatureGate']>[1],
          negate?: boolean,
          context?: Parameters<TogglyClient['evaluateFeatureGate']>[3],
          kind?: string,
          overrides?: EvalContextArg,
        ) =>
          target.evaluateFeatureGate(
            featureKeys,
            requirement,
            negate,
            context,
            kind,
            mergeEvalArg(ambient, overrides),
          )
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, prop, value, receiver) {
      if (prop === 'identity') {
        // Ignore — request identity must not mutate the shared client.
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
  })
}

/**
 * Middleware that resolves and caches ambient EvalContext on the H3 event.
 *
 * @example
 * ```ts
 * // server/middleware/toggly-context.ts
 * export default defineTogglyContextMiddleware({
 *   getIdentity: (event) => getCookie(event, 'userId'),
 *   getGroups: () => ['beta'],
 *   getClaims: () => ({ role: 'admin' }),
 * })
 * ```
 */
export function defineTogglyContextMiddleware(
  providers: EventEvalContextProviders = {},
): EventHandler {
  return defineEventHandler(async (event: H3Event) => {
    await resolveEventEvalContext(event, providers)
  })
}

/**
 * Create a feature flag middleware for Nitro/H3
 *
 * @example
 * ```ts
 * // In server/middleware/feature.ts
 * export default defineFeatureMiddleware({
 *   featureKey: 'new-api',
 *   statusCode: 404,
 *   message: 'Feature not available'
 * })
 * ```
 */
export function defineFeatureMiddleware(
  options: FeatureMiddlewareOptions
): EventHandler {
  const {
    featureKey,
    requirement = 'all',
    negate = false,
    statusCode = 404,
    message = 'Feature not available',
    onDisabled,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return defineEventHandler(async (event: H3Event) => {
    const client = getServerToggly()

    if (!client) {
      // Fail closed: gated routes must not proceed without an initialized client
      console.warn('[Toggly] Server client not initialized in middleware')
      throw createError({
        statusCode: 503,
        statusMessage: 'Feature flags unavailable',
        message: 'Feature flags unavailable',
      })
    }

    const ambient = await resolveEventEvalContext(event)
    const isEnabled = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate,
      undefined,
      undefined,
      toEvalOverrides(ambient),
    )

    if (!isEnabled) {
      if (onDisabled) {
        await onDisabled()
      }

      throw createError({
        statusCode,
        statusMessage: message,
        message,
      })
    }
  })
}

/**
 * Create a route handler that requires a feature to be enabled
 *
 * @example
 * ```ts
 * // In server/api/beta-feature.ts
 * export default defineFeatureHandler('beta-api', async (event) => {
 *   return { message: 'Beta feature response' }
 * })
 * ```
 */
export function defineFeatureHandler(
  featureKey: string | string[],
  handler: EventHandler,
  options: Omit<FeatureMiddlewareOptions, 'featureKey'> = {}
): EventHandler {
  const {
    requirement = 'all',
    negate = false,
    statusCode = 404,
    message = 'Feature not available',
    onDisabled,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return defineEventHandler(async (event: H3Event) => {
    const client = getServerToggly()

    if (!client) {
      console.warn('[Toggly] Server client not initialized in handler')
      throw createError({
        statusCode: 503,
        statusMessage: 'Feature flags unavailable',
        message: 'Feature flags unavailable',
      })
    }

    const ambient = await resolveEventEvalContext(event)
    const isEnabled = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate,
      undefined,
      undefined,
      toEvalOverrides(ambient),
    )

    if (!isEnabled) {
      if (onDisabled) {
        await onDisabled()
      }

      throw createError({
        statusCode,
        statusMessage: message,
        message,
      })
    }

    return handler(event)
  })
}

/**
 * Get the Toggly client from an H3 event context.
 * Uses cached ambient EvalContext when present (from
 * `defineTogglyContextMiddleware` / `resolveEventEvalContext`); otherwise
 * binds sync defaults from H3 headers (`x-toggly-identity` + `fromHttpRequest`).
 * For async providers, call `resolveEventEvalContext` (or the context
 * middleware) before this helper.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const toggly = useEventToggly(event)
 *   const isEnabled = await toggly.isFeatureOn('my-feature')
 *   return { enabled: isEnabled }
 * })
 * ```
 */
export function useEventToggly(event: H3Event) {
  const client = useServerToggly()
  const ambient =
    getCachedEventEvalContext(event) ?? syncDefaultEventAmbient(event)
  return bindEventEvalContext(client, ambient)
}

/**
 * Resolve ambient EvalContext (providers + headers) and return a bound client.
 */
export async function getEventToggly(event: H3Event): Promise<TogglyClient> {
  const client = useServerToggly()
  const ambient = await resolveEventEvalContext(event)
  return bindEventEvalContext(client, ambient)
}

/**
 * Check if a feature is enabled for the current request.
 * Ambient EvalContext is resolved from providers / H3 headers; pass
 * `identityOrOptions` to override field-by-field.
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   if (await isEventFeatureOn(event, 'new-feature')) {
 *     return { version: 2 }
 *   }
 *   return { version: 1 }
 * })
 * ```
 */
export async function isEventFeatureOn(
  event: H3Event,
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions,
): Promise<boolean> {
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized')
    return false
  }

  const ambient = await resolveEventEvalContext(event)
  const merged = mergeFeatureCheckOptions(
    ambient,
    resolveFeatureCheckArgs(identityOrOptions),
  )
  return client.isFeatureOn(
    featureKey,
    undefined,
    undefined,
    toEvalOverrides(merged),
  )
}

/**
 * Check if a feature is disabled for the current request
 */
export async function isEventFeatureOff(
  event: H3Event,
  featureKey: string,
  identityOrOptions?: string | FeatureCheckOptions,
): Promise<boolean> {
  const isOn = await isEventFeatureOn(event, featureKey, identityOrOptions)
  return !isOn
}

/**
 * Evaluate a feature gate for the current request
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   const hasAllFeatures = await evaluateEventFeatureGate(
 *     event,
 *     ['feature-a', 'feature-b'],
 *     'all'
 *   )
 *   return { hasAllFeatures }
 * })
 * ```
 */
export async function evaluateEventFeatureGate(
  event: H3Event,
  featureKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
  identityOrOptions?: string | FeatureCheckOptions,
): Promise<boolean> {
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized')
    return false
  }

  const ambient = await resolveEventEvalContext(event)
  const merged = mergeFeatureCheckOptions(
    ambient,
    resolveFeatureCheckArgs(identityOrOptions),
  )
  return client.evaluateFeatureGate(
    featureKeys,
    requirement,
    negate,
    undefined,
    undefined,
    toEvalOverrides(merged),
  )
}
