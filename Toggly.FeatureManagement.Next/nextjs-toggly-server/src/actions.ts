import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import {
  snapshotEvaluatedBooleans,
  toBooleanDefinitions,
} from '@ops-ai/nextjs-toggly-core'
import { getServerToggly } from './server-client'
import type { FeatureGateResult } from './types'

/**
 * Server Action to check if a feature is enabled
 *
 * @example
 * ```tsx
 * // In a Server Action
 * 'use server'
 * import { checkFeature } from '@ops-ai/nextjs-toggly-server'
 *
 * export async function submitForm(formData: FormData) {
 *   const isNewFlowEnabled = await checkFeature('new-form-flow')
 *   if (isNewFlowEnabled) {
 *     // New flow logic
 *   }
 * }
 * ```
 */
export async function checkFeature(
  featureKey: string,
  identity?: string
): Promise<boolean> {
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized in checkFeature')
    return false
  }

  return client.isFeatureOn(featureKey, undefined, undefined, identity)
}

/**
 * Server Action to check if a feature is disabled
 */
export async function checkFeatureOff(
  featureKey: string,
  identity?: string
): Promise<boolean> {
  const isOn = await checkFeature(featureKey, identity)
  return !isOn
}

/**
 * Server Action to evaluate a feature gate
 *
 * @example
 * ```tsx
 * 'use server'
 * import { checkFeatureGate } from '@ops-ai/nextjs-toggly-server'
 *
 * export async function adminAction() {
 *   const result = await checkFeatureGate({
 *     featureKeys: ['admin-feature', 'beta-feature'],
 *     requirement: 'all',
 *   })
 *
 *   if (!result.allowed) {
 *     throw new Error('Feature not available')
 *   }
 * }
 * ```
 */
export async function checkFeatureGate(options: {
  featureKeys: string | string[]
  requirement?: FeatureRequirement
  negate?: boolean
  identity?: string
}): Promise<FeatureGateResult> {
  const {
    featureKeys: rawKeys,
    requirement = 'all',
    negate = false,
    identity,
  } = options

  const featureKeys = Array.isArray(rawKeys) ? rawKeys : [rawKeys]
  const client = getServerToggly()

  if (!client) {
    return {
      allowed: false,
      featureKeys,
      error: 'Toggly server client not initialized',
    }
  }

  try {
    const allowed = await client.evaluateFeatureGate(
      featureKeys,
      requirement,
      negate,
      undefined,
      undefined,
      identity
    )

    return {
      allowed,
      featureKeys,
    }
  } catch (error) {
    return {
      allowed: false,
      featureKeys,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Server Action wrapper that requires a feature to be enabled
 *
 * @example
 * ```tsx
 * 'use server'
 * import { withFeature } from '@ops-ai/nextjs-toggly-server'
 *
 * export const betaAction = withFeature('beta-feature', async (data: FormData) => {
 *   // This only runs if 'beta-feature' is enabled
 *   return { success: true }
 * })
 * ```
 */
export function withFeature<T extends unknown[], R>(
  featureKey: string | string[],
  action: (...args: T) => Promise<R>,
  options: {
    requirement?: FeatureRequirement
    negate?: boolean
    identity?: string
    onDisabled?: () => Promise<R>
  } = {}
): (...args: T) => Promise<R> {
  const { requirement = 'all', negate = false, identity, onDisabled } = options

  return async (...args: T): Promise<R> => {
    const result = await checkFeatureGate({
      featureKeys: featureKey,
      requirement,
      negate,
      identity,
    })

    if (!result.allowed) {
      if (onDisabled) {
        return onDisabled()
      }
      throw new Error(`Feature gate not satisfied: ${result.featureKeys.join(', ')}`)
    }

    return action(...args)
  }
}

/**
 * Get all current feature states (for hydration)
 */
export async function getFeatures(): Promise<Record<string, boolean>> {
  const client = getServerToggly()

  if (!client) {
    return {}
  }

  const defs = client.getDefinitions()
  if (defs.size === 0) {
    return toBooleanDefinitions({ ...client.state.features })
  }

  return toBooleanDefinitions({
    ...client.config.featureDefaults,
    ...snapshotEvaluatedBooleans(defs, {
      identity: client.config.identity,
      groups: client.config.groups,
      traits: client.config.claims,
    }),
  })
}

/**
 * Get specific feature states (for selective hydration)
 */
export async function getFeatureStates(
  featureKeys: string[]
): Promise<Record<string, boolean>> {
  const client = getServerToggly()

  if (!client) {
    return Object.fromEntries(featureKeys.map((key) => [key, false]))
  }

  const result: Record<string, boolean> = {}
  for (const key of featureKeys) {
    result[key] = await client.isFeatureOn(key)
  }

  return result
}
