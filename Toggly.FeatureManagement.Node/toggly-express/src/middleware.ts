import type { Request, Response, NextFunction, RequestHandler } from 'express'
import {
  createTogglyClient,
  normalizeFeatureKeys,
  fromHttpRequest,
  type TogglyClient,
  type EvaluationContext,
} from '@ops-ai/toggly-node-core'
import type {
  TogglyExpressConfig,
  TogglyRequest,
  FeatureGateOptions,
  FeatureRouteOptions,
} from './types.js'

// Module-level client singleton
let expressClient: TogglyClient | null = null

/**
 * Get the Express Toggly client
 */
export function getExpressToggly(): TogglyClient | null {
  return expressClient
}

/**
 * Get identity from request
 */
async function extractIdentity(
  req: Request,
  config: TogglyExpressConfig
): Promise<string | undefined> {
  // Use custom extractor if provided
  if (config.getIdentity) {
    return config.getIdentity(req)
  }

  // Default: check header, then session
  const headerIdentity = req.headers['x-toggly-identity']
  if (typeof headerIdentity === 'string') {
    return headerIdentity
  }

  // Check session if available
  const session = (req as Request & { session?: { userId?: string } }).session
  if (session?.userId) {
    return session.userId
  }

  return undefined
}

/**
 * Get evaluation context from request
 */
async function extractContext(
  req: Request,
  config: TogglyExpressConfig
): Promise<EvaluationContext> {
  const headers = req.headers as Record<string, string | string[] | undefined>
  const headerRequest = fromHttpRequest(headers).request

  // Custom full context: use returned fields, fill missing request from headers
  if (config.getContext) {
    const custom = await config.getContext(req)
    return {
      ...custom,
      request: custom.request ?? headerRequest,
    }
  }

  // Default: identity / groups / claims providers + segment request headers
  const identity = await extractIdentity(req, config)
  const session = (req as Request & { session?: { groups?: string[] } }).session
  const groups = config.getGroups ? await config.getGroups(req) : session?.groups
  const claims = config.getClaims ? await config.getClaims(req) : undefined
  const fromReq = fromHttpRequest(headers, {
    identity,
    groups,
    claims,
  })

  return {
    identity: fromReq.identity,
    groups: fromReq.groups,
    claims: fromReq.claims,
    request: fromReq.request,
    traits: {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      method: req.method,
    },
  }
}

/**
 * Create Toggly middleware for Express
 *
 * This middleware:
 * 1. Initializes the Toggly client (if not already initialized)
 * 2. Attaches feature flag helpers to the request object
 * 3. Extracts identity and context from the request
 */
export function togglyMiddleware(config: TogglyExpressConfig): RequestHandler {
  // Initialize client lazily
  let initPromise: Promise<void> | null = null

  const initialize = async () => {
    if (!expressClient) {
      const {
        onError: _onError,
        getIdentity: _getIdentity,
        getGroups: _getGroups,
        getClaims: _getClaims,
        getContext: _getContext,
        ...serverConfig
      } = config
      expressClient = createTogglyClient(serverConfig)
      await expressClient.init()
    }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Ensure client is initialized
      if (!initPromise) {
        initPromise = initialize()
      }
      await initPromise

      if (!expressClient) {
        throw new Error('Toggly client failed to initialize')
      }

      // Extract context from request
      const context = await extractContext(req, config)
      const identity = context.identity

      // Attach Toggly helpers to request
      const togglyReq = req as TogglyRequest
      togglyReq.toggly = {
        client: expressClient,
        features: expressClient.state.features,
        identity,
        context,
        isFeatureOn: (featureKey: string) =>
          expressClient!.isFeatureOn(featureKey, context),
        isFeatureOff: (featureKey: string) =>
          expressClient!.isFeatureOff(featureKey, context),
        evaluateFeatureGate: (featureKeys, requirement, negate) =>
          expressClient!.evaluateFeatureGate(featureKeys, requirement, negate, context),
      }

      next()
    } catch (error) {
      if (config.onError) {
        config.onError(error as Error, req, res, next)
      } else {
        next(error)
      }
    }
  }
}

/**
 * Create a feature gate middleware
 *
 * Protects routes by checking if specified features are enabled
 */
export function featureGate(options: FeatureGateOptions): RequestHandler {
  const {
    featureKey,
    requirement = 'all',
    negate = false,
    onDisabled,
    redirectTo,
    redirectStatus = 302,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return async (req: Request, res: Response, next: NextFunction) => {
    const togglyReq = req as TogglyRequest

    if (!togglyReq.toggly) {
      // Toggly middleware not applied
      return next(new Error('Toggly middleware must be applied before featureGate'))
    }

    try {
      const isEnabled = await togglyReq.toggly.evaluateFeatureGate(
        featureKeys,
        requirement,
        negate
      )

      if (isEnabled) {
        return next()
      }

      // Feature is disabled
      if (redirectTo) {
        return res.redirect(redirectStatus, redirectTo)
      }

      if (onDisabled) {
        return onDisabled(req, res, next)
      }

      // Default: 404
      return res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource is not available',
      })
    } catch (error) {
      return next(error)
    }
  }
}

/**
 * Create middleware that applies feature gates based on route patterns
 */
export function featureRoutes(routes: FeatureRouteOptions[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    for (const route of routes) {
      // Check if route matches
      const pathMatches =
        typeof route.path === 'string'
          ? req.path === route.path || req.path.startsWith(route.path)
          : route.path.test(req.path)

      if (!pathMatches) {
        continue
      }

      // Check if method matches
      if (route.methods && !route.methods.includes(req.method.toUpperCase())) {
        continue
      }

      // Apply feature gate
      const gate = featureGate(route)
      return gate(req, res, next)
    }

    // No matching route, continue
    return next()
  }
}

/**
 * Create a route handler that only executes if feature is enabled
 */
export function withFeature(
  featureKey: string | string[],
  handler: RequestHandler,
  options: Omit<FeatureGateOptions, 'featureKey'> = {}
): RequestHandler {
  const gate = featureGate({ featureKey, ...options })

  return async (req: Request, res: Response, next: NextFunction) => {
    return gate(req, res, (err?: unknown) => {
      if (err) {
        return next(err)
      }
      return handler(req, res, next)
    })
  }
}

/**
 * Get features as JSON endpoint handler
 */
export function featuresHandler(): RequestHandler {
  return (req: Request, res: Response) => {
    const togglyReq = req as TogglyRequest

    if (!togglyReq.toggly) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Toggly middleware not configured',
      })
    }

    return res.json({
      features: togglyReq.toggly.features,
      identity: togglyReq.toggly.identity,
    })
  }
}

/**
 * Close the Express Toggly client
 */
export function closeExpressToggly(): void {
  if (expressClient) {
    expressClient.close()
    expressClient = null
  }
}
