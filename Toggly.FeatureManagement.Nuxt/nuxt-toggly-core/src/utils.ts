import type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
import { evaluateEvaluatedGate } from '@ops-ai/toggly-hooks-types'

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  if (typeof crypto === 'undefined') {
    throw new Error('[Toggly] Web Crypto is required to generate an automatic identity. Configure identity explicitly in this runtime.')
  }
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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
    if (Object.hasOwn(source, key)) {
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
  // Avoid direct window/document identifiers so Node-only dependents can
  // typecheck without DOM libs (OPS-727 Nuxt release gate).
  return (
    typeof globalThis !== 'undefined' &&
    'window' in globalThis &&
    'document' in globalThis
  )
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
