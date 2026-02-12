import type { TogglyConfig, FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import type { NextRequest, NextResponse } from 'next/server'

/**
 * Edge runtime Toggly configuration
 */
export interface TogglyEdgeConfig extends TogglyConfig {
  /** Cache feature definitions at the edge (default: true) */
  cache?: boolean
  /** Cache TTL in seconds (default: 60) */
  cacheTtl?: number
}

/**
 * Middleware feature gate options
 */
export interface MiddlewareFeatureOptions {
  /** Feature key(s) to check */
  featureKey: string | string[]
  /** Requirement for multiple features */
  requirement?: FeatureRequirement
  /** Negate the result */
  negate?: boolean
  /** Response when feature is disabled */
  onDisabled?: (request: NextRequest) => NextResponse | Response | Promise<NextResponse | Response>
  /** Redirect URL when feature is disabled */
  redirectTo?: string
  /** Status code for redirect (default: 307) */
  redirectStatus?: 301 | 302 | 303 | 307 | 308
  /** Rewrite URL when feature is disabled */
  rewriteTo?: string
}

/**
 * Middleware handler with feature context
 */
export type FeatureMiddlewareHandler = (
  request: NextRequest,
  context: FeatureMiddlewareContext
) => NextResponse | Response | Promise<NextResponse | Response>

/**
 * Context passed to feature middleware handlers
 */
export interface FeatureMiddlewareContext {
  /** Whether the feature is enabled */
  isEnabled: boolean
  /** The feature keys that were evaluated */
  featureKeys: string[]
  /** All current feature definitions */
  features: Record<string, boolean>
  /** User identity */
  identity: string | undefined
}

/**
 * Path matcher for middleware
 */
export interface FeaturePathMatcher {
  /** Path pattern (supports wildcards) */
  path: string | RegExp
  /** Feature configuration for this path */
  feature: MiddlewareFeatureOptions
}

/**
 * Edge client state
 */
export interface EdgeClientState {
  /** Whether the client has been initialized */
  initialized: boolean
  /** Current feature definitions */
  features: Record<string, boolean>
  /** Last fetch timestamp */
  lastFetch: number | null
  /** Last error (if any) */
  error: Error | null
}
