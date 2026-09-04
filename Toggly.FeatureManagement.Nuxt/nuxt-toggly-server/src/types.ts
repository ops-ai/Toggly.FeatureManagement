import type { H3Event } from 'h3'
import type { TogglyConfig, TogglyClient } from '@ops-ai/nuxt-toggly-core'
import type { FeatureCheckOptions } from './feature-check'

export type { FeatureCheckOptions } from './feature-check'

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
 * Providers that build ambient EvalContext per H3 event.
 * Prefer registering via `configureEventEvalContext` or
 * `defineTogglyContextMiddleware`.
 */
export interface EventEvalContextProviders {
  /**
   * Extract identity from the event.
   * Default (when unset): `x-toggly-identity` header.
   */
  getIdentity?: (
    event: H3Event,
  ) => string | undefined | Promise<string | undefined>

  /** Extract group memberships for Targeting / Percentage filters. */
  getGroups?: (
    event: H3Event,
  ) => string[] | undefined | Promise<string[] | undefined>

  /** Extract principal / JWT-style claims for UserClaims filters. */
  getClaims?: (
    event: H3Event,
  ) =>
    | Record<string, string>
    | undefined
    | Promise<Record<string, string> | undefined>

  /**
   * Full ambient context. When provided, returned fields are used;
   * missing `request` is still filled from H3 headers via `fromHttpRequest`.
   */
  getContext?: (
    event: H3Event,
  ) => FeatureCheckOptions | Promise<FeatureCheckOptions>
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
