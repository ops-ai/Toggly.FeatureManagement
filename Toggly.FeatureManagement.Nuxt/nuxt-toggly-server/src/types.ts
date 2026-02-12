import type { TogglyConfig, TogglyClient } from '@ops-ai/nuxt-toggly-core'

/**
 * Server-side Toggly configuration extending core config
 */
export interface TogglyServerConfig extends TogglyConfig {
  /** Cache feature definitions in server storage */
  cache?: boolean
  /** Cache TTL in milliseconds (default: 60000 - 1 minute) */
  cacheTtl?: number
  /** Storage key prefix for cached definitions */
  cacheKeyPrefix?: string
}

/**
 * H3 event context with Toggly
 */
export interface TogglyEventContext {
  toggly: TogglyClient
}

/**
 * Server-side storage interface for caching
 */
export interface TogglyStorage {
  getItem<T>(key: string): Promise<T | null>
  setItem<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>
  removeItem(key: string): Promise<void>
  hasItem(key: string): Promise<boolean>
}

/**
 * Middleware options for feature gating
 */
export interface FeatureMiddlewareOptions {
  /** Feature key or keys to check */
  featureKey: string | string[]
  /** Requirement type for multiple features */
  requirement?: 'all' | 'any'
  /** Negate the result */
  negate?: boolean
  /** Response status code when feature is disabled (default: 404) */
  statusCode?: number
  /** Response message when feature is disabled */
  message?: string
  /** Custom handler when feature is disabled */
  onDisabled?: () => void | Promise<void>
}
