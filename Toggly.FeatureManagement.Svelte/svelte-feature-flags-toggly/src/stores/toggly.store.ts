import { writable, derived, get, type Writable } from 'svelte/store'
import type { TogglyService } from '../services/toggly.service'
import type { EvaluatedVariantDef, VariantResult } from '../services/variant.types'

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

/** Replacing the service releases the previous owner before exposing the new one. */
const serviceStore = writable<TogglyService | null>(null)
let currentService: TogglyService | null = null
function setService(next: TogglyService | null): void {
  if (next === currentService) return
  const previous = currentService
  currentService = next
  previous?.dispose()
  // Do not expose a prior app/environment's projections to the new owner.
  togglyFlagsStore.set({})
  togglyVariantsStore.set({})
  serviceStore.set(next)
}

/** @internal Publish one owner and its initial projections as one store transition. */
export function _setTogglyServiceSnapshot(
  next: TogglyService,
  flags: { [key: string]: boolean },
  variants: { [key: string]: EvaluatedVariantDef },
): void {
  if (next === currentService) return
  const previous = currentService
  currentService = next
  previous?.dispose()
  // Publish projections while subscribers still have no owner. The service
  // transition then coalesces these updates into one consumer evaluation.
  togglyFlagsStore.set(flags)
  togglyVariantsStore.set(variants)
  serviceStore.set(next)
}
export const togglyServiceStore: Writable<TogglyService | null> = {
  subscribe: serviceStore.subscribe,
  set: setService,
  update(updater) { setService(updater(currentService)) },
}

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
  return derived(
    [togglyVariantsStore, togglyLocalGatesRevision, togglyServiceStore],
    ([$defs, _revision, service]): unknown | null => {
      if (service) return service.getVariantValue(featureKey)
      const entry = $defs[featureKey]
      if (!entry?.variant) {
        return null
      }
      return entry.configurationValue ?? null
    },
  )
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

/** Record explicit usage without evaluating the feature. */
export function recordUsage(featureKey: string, variant = 'enabled'): void {
  getTogglyService().recordUsage(featureKey, variant)
}

/** Record an explicit view without evaluating the feature. */
export function recordView(featureKey: string, variant = 'enabled'): void {
  getTogglyService().recordView(featureKey, variant)
}

export function incrementCounter(metricKey: string, value = 1): void {
  getTogglyService().incrementCounter(metricKey, value)
}

export function setGauge(metricKey: string, value: number): void {
  getTogglyService().setGauge(metricKey, value)
}

export function flushTelemetry(): Promise<void> {
  return getTogglyService().flushTelemetry()
}
