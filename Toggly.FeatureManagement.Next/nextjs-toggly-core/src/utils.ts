import type { FeatureDefinitions, FeatureRequirement } from './types'

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Evaluate a feature gate
 */
export function evaluateGate(
  features: FeatureDefinitions,
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate: boolean = false
): boolean {
  if (featureKeys.length === 0) {
    return !negate
  }

  let result: boolean

  if (requirement === 'any') {
    result = featureKeys.some((key) => features[key] === true)
  } else {
    result = featureKeys.every((key) => features[key] === true)
  }

  return negate ? !result : result
}

/**
 * Deep merge two objects
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target }

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (
        sourceValue !== undefined &&
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== undefined &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[Extract<keyof T, string>]
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }

  return result
}

/**
 * Normalize feature keys to always be an array
 */
export function normalizeFeatureKeys(
  featureKey: string | string[]
): string[] {
  if (Array.isArray(featureKey)) {
    return featureKey
  }
  return [featureKey]
}

/**
 * Check if we're running in a browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * Check if we're running in a server environment
 */
export function isServer(): boolean {
  return !isBrowser()
}

/**
 * Check if we're running in an edge runtime
 */
export function isEdgeRuntime(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    // @ts-expect-error - EdgeRuntime global
    typeof globalThis.EdgeRuntime !== 'undefined'
  )
}
