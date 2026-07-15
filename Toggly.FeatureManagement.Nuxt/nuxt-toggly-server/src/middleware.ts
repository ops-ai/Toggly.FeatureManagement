import type { H3Event, EventHandler } from 'h3'
import { createError, defineEventHandler, getHeader, setResponseStatus } from 'h3'
import { normalizeFeatureKeys, evaluateGate } from '@ops-ai/nuxt-toggly-core'
import type { FeatureMiddlewareOptions } from './types'
import { getServerToggly, useServerToggly } from './server-client'

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

    // Get identity from header if present
    const identity = getHeader(event, 'x-toggly-identity')
    if (identity) {
      client.identity = identity
    }

    const isEnabled = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate
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

    // Get identity from header if present
    const identity = getHeader(event, 'x-toggly-identity')
    if (identity) {
      client.identity = identity
    }

    const isEnabled = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate
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

  // Get identity from header if present
  const identity = getHeader(event, 'x-toggly-identity')
  if (identity) {
    client.identity = identity
  }

  return client
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

  const identity = getHeader(event, 'x-toggly-identity')
  if (identity) {
    client.identity = identity
  }

  return client.isFeatureOn(featureKey)
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

  const identity = getHeader(event, 'x-toggly-identity')
  if (identity) {
    client.identity = identity
  }

  return client.evaluateFeatureGate(featureKeys, requirement, negate)
}
