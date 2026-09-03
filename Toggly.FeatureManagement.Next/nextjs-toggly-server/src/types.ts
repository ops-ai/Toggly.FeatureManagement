import type { TogglyConfig } from '@ops-ai/nextjs-toggly-core'
import type { FeatureCheckOptions } from './feature-check'

export type { EntityContextInput, FeatureCheckOptions } from './feature-check'

/**
 * Server-side Toggly configuration
 */
export interface TogglyServerConfig extends TogglyConfig {
  /** Enable server-side caching (default: true) */
  cache?: boolean
  /** Cache TTL in milliseconds (default: 60000 - 1 minute) */
  cacheTtl?: number
  /** Cache key prefix (default: 'toggly:server:') */
  cacheKeyPrefix?: string
}

/**
 * Storage interface for server-side caching
 */
export interface TogglyStorage {
  getItem<T>(key: string): Promise<T | null>
  setItem<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>
  removeItem(key: string): Promise<void>
  hasItem(key: string): Promise<boolean>
}

/**
 * Request context for server-side feature evaluation
 */
export interface RequestContext {
  /** User identity */
  identity?: string
  /** Request headers */
  headers?: Headers | Record<string, string>
  /** Request cookies */
  cookies?: Record<string, string>
}

/**
 * Options for server-side feature checks (entity context + user identity).
 * `context` is the entity / page object for Context Property filters, not HTTP request state.
 */
export type ServerFeatureOptions = FeatureCheckOptions

/**
 * Server action return type for feature gates
 */
export interface FeatureGateResult {
  /** Whether the feature gate passed */
  allowed: boolean
  /** The feature keys that were evaluated */
  featureKeys: string[]
  /** Error message if gate failed */
  error?: string
}
