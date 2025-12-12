import { writable, derived, get } from 'svelte/store'
import type { TogglyService } from '../services/toggly.service'

/**
 * Store for the Toggly service instance
 */
export const togglyServiceStore = writable<TogglyService | null>(null)

/**
 * Store for feature flags (key-value pairs)
 */
export const togglyFlagsStore = writable<{ [key: string]: boolean }>({})

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
  return derived(togglyFlagsStore, ($flags) => $flags[featureKey] ?? false)
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
