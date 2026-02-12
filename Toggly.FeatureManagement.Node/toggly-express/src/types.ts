import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type {
  TogglyClient,
  TogglyServerConfig,
  FeatureRequirement,
  EvaluationContext,
  FeatureDefinitions,
} from '@ops-ai/toggly-node-core'

/**
 * Express-specific configuration
 */
export interface TogglyExpressConfig extends TogglyServerConfig {
  /**
   * Function to extract identity from request
   * Default: Uses x-toggly-identity header or session.userId
   */
  getIdentity?: (req: Request) => string | undefined | Promise<string | undefined>

  /**
   * Function to extract evaluation context from request
   */
  getContext?: (req: Request) => EvaluationContext | Promise<EvaluationContext>

  /**
   * Custom error handler for middleware errors
   */
  onError?: (error: Error, req: Request, res: Response, next: NextFunction) => void
}

/**
 * Augmented Express Request with Toggly data
 */
export interface TogglyRequest extends Request {
  toggly?: {
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
}

/**
 * Feature gate middleware options
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
  onDisabled?: RequestHandler

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

declare global {
  namespace Express {
    interface Request {
      toggly?: TogglyRequest['toggly']
    }
  }
}
