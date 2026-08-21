import type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
import { evaluateEvaluatedGate } from '@ops-ai/toggly-hooks-types'

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
 * Normalize feature keys to an array
 */
export function normalizeFeatureKeys(
  keys: string | string[] | undefined
): string[] {
  if (!keys || keys.length === 0) return []
  if (typeof keys === 'string') return [keys]
  return keys
}

/**
 * Evaluate a feature gate
 */
export function evaluateGate(
  features: EvaluatedDefinitions,
  featureKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
  entityContext?: TogglyEntityContext | null,
): boolean {
  return evaluateEvaluatedGate(features, featureKeys, requirement, negate, entityContext)
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target }

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key]
      const targetValue = target[key]

      if (
        isPlainObject(sourceValue) &&
        isPlainObject(targetValue)
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
 * Check if a value is a plain object
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
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
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

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
 * Create a deferred promise
 */
export function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}
