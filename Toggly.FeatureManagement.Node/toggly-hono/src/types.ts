import type { Context } from 'hono'
import type {
  TogglyClient,
  TogglyServerConfig,
  FeatureRequirement,
  EvaluationContext,
  FeatureDefinitions,
} from '@ops-ai/toggly-node-core'

/**
 * Hono-specific configuration
 */
export interface TogglyHonoConfig extends TogglyServerConfig {
  /**
   * Function to extract identity from Hono context
   * Default: Uses x-toggly-identity header
   */
  getIdentity?: (c: Context) => string | undefined | Promise<string | undefined>

  /**
   * Function to extract evaluation context from Hono context
   */
  getContext?: (c: Context) => EvaluationContext | Promise<EvaluationContext>
}

/**
 * Toggly data stored in Hono context variables
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
  onDisabled?: (c: Context) => Response | Promise<Response>

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

// Augment Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    toggly: TogglyContextData
  }
}
