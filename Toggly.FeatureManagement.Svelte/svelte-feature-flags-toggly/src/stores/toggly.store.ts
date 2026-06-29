import { writable, derived, get } from 'svelte/store'
import type { TogglyService } from '../services/toggly.service'
import type { EvaluatedVariantDef, VariantResult } from '../services/variant.types'

/**
 * Store for the Toggly service instance
 */
export const togglyServiceStore = writable<TogglyService | null>(null)

/**
 * Store for feature flags (key-value pairs)
 */
export const togglyFlagsStore = writable<{ [key: string]: boolean }>({})

/**
 * Store for variant definitions (from /evaluated-variants-signed) when enableVariants is true
 */
export const togglyVariantsStore = writable<{ [key: string]: EvaluatedVariantDef }>({})

/** Bumped when device-local gates change (triggers derived stores to recompute). */
export const togglyLocalGatesRevision = writable(0)

/**
 * Get the Toggly service instance from the store
 * @throws Error if service is not initialized
 */
export function getTogglyService(): TogglyService {
  const service = get(togglyServiceStore)
  if (!service) {
    throw new Error('Toggly service not initialized. Call createToggly() first.')
  }
  return service
}

/**
 * Create a derived store for a specific feature flag
 * @param featureKey - The feature flag key
 * @returns A derived store that returns the boolean value of the feature flag
 */
export function createFeatureStore(featureKey: string) {
  return derived(
    [togglyFlagsStore, togglyLocalGatesRevision, togglyServiceStore],
    ([$flags, _revision, service]) => {
      if (service) {
        return service.getEffectiveFlagValue(featureKey)
      }
      return $flags[featureKey] ?? false
    },
  )
}

/**
 * Derived store for a feature's variant assignment (name + configurationValue).
 * Returns null when the feature has no variant or variants are disabled.
 */
export function createVariantStore(featureKey: string) {
  return derived(
    [togglyVariantsStore, togglyLocalGatesRevision, togglyServiceStore],
    ([$defs, _revision, service]): VariantResult | null => {
      if (service) {
        return service.getVariant(featureKey)
      }
      const entry = $defs[featureKey]
      if (!entry?.variant) {
        return null
      }
      return {
        name: entry.variant,
        configurationValue: entry.configurationValue,
      }
    },
  )
}

/**
 * Derived store for a feature's variant configuration value only.
 */
export function createVariantValueStore(featureKey: string) {
  return derived(togglyVariantsStore, ($defs): unknown | null => {
    const entry = $defs[featureKey]
    if (!entry?.variant) {
      return null
    }
    return entry.configurationValue ?? null
  })
}

/**
 * Check if a feature is enabled
 * @param featureKey - The feature flag key
 * @returns Promise resolving to true if feature is enabled
 */
export async function isFeatureOn(featureKey: string): Promise<boolean> {
  const service = getTogglyService()
  return await service.isFeatureOn(featureKey)
}

/**
 * Check if a feature is disabled
 * @param featureKey - The feature flag key
 * @returns Promise resolving to true if feature is disabled
 */
export async function isFeatureOff(featureKey: string): Promise<boolean> {
  const service = getTogglyService()
  return await service.isFeatureOff(featureKey)
}

/**
 * Evaluate a feature gate (multiple features with requirement and negate)
 * @param featureKeys - Array of feature flag keys
 * @param requirement - 'all' or 'any' (default: 'all')
 * @param negate - Whether to negate the result (default: false)
 * @returns Promise resolving to the evaluation result
 */
export async function evaluateFeatureGate(
  featureKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
): Promise<boolean> {
  const service = getTogglyService()
  return await service.evaluateFeatureGate(featureKeys, requirement, negate)
}
