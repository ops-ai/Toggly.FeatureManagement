import type { H3Event, EventHandler } from 'h3'
import { createError, defineEventHandler, getHeader } from 'h3'
import { normalizeFeatureKeys } from '@ops-ai/nuxt-toggly-core'
import type { TogglyClient } from '@ops-ai/nuxt-toggly-core'
import type { FeatureMiddlewareOptions } from './types'
import { getServerToggly, useServerToggly } from './server-client'

/**
 * Request-scoped view of the shared server client that binds identityOverride
 * without mutating process-wide `client.identity`.
 */
function bindRequestIdentity(
  client: TogglyClient,
  identity: string | undefined
): TogglyClient {
  if (!identity) {
    return client
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'identity') {
        return identity
      }
      if (prop === 'isFeatureOn') {
        return (
          featureKey: string,
          context?: Parameters<TogglyClient['isFeatureOn']>[1],
          kind?: string,
        ) => target.isFeatureOn(featureKey, context, kind, identity)
      }
      if (prop === 'isFeatureOff') {
        return (
          featureKey: string,
          context?: Parameters<TogglyClient['isFeatureOff']>[1],
          kind?: string,
        ) => target.isFeatureOff(featureKey, context, kind, identity)
      }
      if (prop === 'evaluateFeatureGate') {
        return (
          featureKeys: string[],
          requirement?: Parameters<TogglyClient['evaluateFeatureGate']>[1],
          negate?: boolean,
          context?: Parameters<TogglyClient['evaluateFeatureGate']>[3],
          kind?: string,
        ) =>
          target.evaluateFeatureGate(
            featureKeys,
            requirement,
            negate,
            context,
            kind,
            identity,
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

function requestIdentity(event: H3Event): string | undefined {
  return getHeader(event, 'x-toggly-identity') || undefined
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

    const identity = requestIdentity(event)
    const isEnabled = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate,
      undefined,
      undefined,
      identity,
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

    const identity = requestIdentity(event)
    const isEnabled = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate,
      undefined,
      undefined,
      identity,
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
 * Get the Toggly client from an H3 event context
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
  return bindRequestIdentity(client, requestIdentity(event))
}

/**
 * Check if a feature is enabled for the current request
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
  featureKey: string
): Promise<boolean> {
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized')
    return false
  }

  return client.isFeatureOn(
    featureKey,
    undefined,
    undefined,
    requestIdentity(event),
  )
}

/**
 * Check if a feature is disabled for the current request
 */
export async function isEventFeatureOff(
  event: H3Event,
  featureKey: string
): Promise<boolean> {
  const isOn = await isEventFeatureOn(event, featureKey)
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
  negate: boolean = false
): Promise<boolean> {
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized')
    return false
  }

  return client.evaluateFeatureGate(
    featureKeys,
    requirement,
    negate,
    undefined,
    undefined,
    requestIdentity(event),
  )
}
