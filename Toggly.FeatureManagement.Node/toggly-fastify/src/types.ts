import type { FastifyRequest } from 'fastify'
import type {
  TogglyClient,
  TogglyServerConfig,
  FeatureRequirement,
  EvaluationContext,
  FeatureDefinitions,
} from '@ops-ai/toggly-node-core'

/**
 * Fastify-specific configuration
 */
export interface TogglyFastifyConfig extends TogglyServerConfig {
  /**
   * Function to extract identity from request
   * Default: Uses x-toggly-identity header
   */
  getIdentity?: (request: FastifyRequest) => string | undefined | Promise<string | undefined>

  /**
   * Function to extract evaluation context from request
   */
  getContext?: (request: FastifyRequest) => EvaluationContext | Promise<EvaluationContext>
}

/**
 * Toggly data attached to Fastify request
 */
export interface TogglyRequestData {
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
  onDisabled?: (request: FastifyRequest) => void | Promise<void>

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

// Augment Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    toggly?: TogglyRequestData
  }
}
