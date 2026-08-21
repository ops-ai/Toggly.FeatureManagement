import type { FeatureDefinitions, FeatureRequirement } from './types.js'
import { evaluateEvaluatedGate, type TogglyEntityContext } from '@ops-ai/toggly-hooks-types'

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  // Use crypto.randomUUID if available (Node 19+), fallback to manual implementation
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Manual UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Evaluate a feature gate with multiple features
 */
export function evaluateGate(
  features: FeatureDefinitions,
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate = false,
  entityContext?: TogglyEntityContext | null,
): boolean {
  if (featureKeys.length === 0) {
    return negate ? true : false
  }

  return evaluateEvaluatedGate(features, featureKeys, requirement, negate, entityContext)
}

/**
 * Normalize feature keys to array
 */
export function normalizeFeatureKeys(keys: string | string[]): string[] {
  if (Array.isArray(keys)) {
    return keys
  }
  return [keys]
}

/**
 * Deep merge objects
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source !== undefined ? (source as T) : target
  }

  const result = { ...target } as Record<string, unknown>
  const sourceObj = source as Record<string, unknown>

  for (const key in sourceObj) {
    if (Object.prototype.hasOwnProperty.call(sourceObj, key)) {
      const sourceValue = sourceObj[key]
      const targetValue = result[key]

      if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        )
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue
      }
    }
  }

  return result as T
}

/**
 * Check if value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  // Check if object is created from Object constructor or has null prototype
  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * Create a debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelay?: number
    maxDelay?: number
    factor?: number
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
  } = options

  let lastError: Error | null = null
  let delay = initialDelay

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt < maxRetries) {
        await sleep(Math.min(delay, maxDelay))
        delay *= factor
      }
    }
  }

  throw lastError
}

/**
 * Create a logger with optional debug mode
 */
export function createLogger(debug: boolean) {
  return {
    debug: (...args: unknown[]) => {
      if (debug) {
        console.log('[Toggly]', ...args)
      }
    },
    info: (...args: unknown[]) => {
      console.log('[Toggly]', ...args)
    },
    warn: (...args: unknown[]) => {
      console.warn('[Toggly]', ...args)
    },
    error: (...args: unknown[]) => {
      console.error('[Toggly]', ...args)
    },
  }
}

/**
 * Hash a string to a number (FNV-1a 32-bit)
 * Used for deterministic percentage rollouts
 */
export function hashString(str: string): number {
  let hash = 2166136261 // FNV offset basis

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619) // FNV prime
  }

  return hash >>> 0 // Convert to unsigned 32-bit integer
}

/**
 * Get percentage bucket for a given identity and feature key
 * Returns a value between 0 and 99.99
 */
export function getPercentageBucket(featureKey: string, identity: string): number {
  const combined = `${featureKey}:${identity}`
  const hash = hashString(combined)
  return (hash % 10000) / 100
}
