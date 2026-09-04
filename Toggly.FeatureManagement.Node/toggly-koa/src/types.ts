import type { Context } from 'koa'
import type {
  TogglyClient,
  TogglyServerConfig,
  FeatureRequirement,
  EvaluationContext,
  FeatureDefinitions,
} from '@ops-ai/toggly-node-core'

/**
 * Koa-specific configuration
 */
export interface TogglyKoaConfig extends TogglyServerConfig {
  /**
   * Function to extract identity from Koa context
   * Default: Uses x-toggly-identity header
   */
  getIdentity?: (ctx: Context) => string | undefined | Promise<string | undefined>

  /**
   * Function to extract group memberships from Koa context
   */
  getGroups?: (ctx: Context) => string[] | undefined | Promise<string[] | undefined>

  /**
   * Function to extract principal / JWT-style claims from Koa context
   */
  getClaims?: (
    ctx: Context
  ) => Record<string, string> | undefined | Promise<Record<string, string> | undefined>

  /**
   * Function to extract evaluation context from Koa context.
   * When provided, returned fields are used; missing `request` is still
   * filled from HTTP headers via `fromHttpRequest`.
   */
  getContext?: (ctx: Context) => EvaluationContext | Promise<EvaluationContext>
}

/**
 * Toggly data stored in Koa context state
 */
export interface TogglyContextData {
  client: TogglyClient
  features: FeatureDefinitions
  identity?: string
  context: EvaluationContext
  isFeatureOn: (featureKey: string) => Promise<boolean>
  isFeatureOff: (featureKey: string) => Promise<boolean>
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement?: FeatureRequirement,
    negate?: boolean
  ) => Promise<boolean>
}

/**
 * Feature gate options for protecting routes
 */
export interface FeatureGateOptions {
  /**
   * Feature key(s) to check
   */
  featureKey: string | string[]

  /**
   * Requirement type for multiple features
   */
  requirement?: FeatureRequirement

  /**
   * Negate the result
   */
  negate?: boolean

  /**
   * Custom handler when feature is disabled
   * Default: Returns 404
   */
  onDisabled?: (ctx: Context) => void | Promise<void>

  /**
   * Custom redirect URL when feature is disabled
   */
  redirectTo?: string

  /**
   * Redirect status code
   */
  redirectStatus?: 301 | 302 | 303 | 307 | 308
}

/**
 * Feature route options for protecting routes
 */
export interface FeatureRouteOptions extends FeatureGateOptions {
  /**
   * Path pattern to match
   */
  path: string | RegExp

  /**
   * HTTP methods to match (default: all)
   */
  methods?: string[]
}

// Augment Koa state
declare module 'koa' {
  interface DefaultState {
    toggly?: TogglyContextData
  }
}
