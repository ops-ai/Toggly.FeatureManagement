import type { Context, MiddlewareHandler, Handler } from 'hono'
import {
  createTogglyClient,
  normalizeFeatureKeys,
  fromHttpRequest,
  type TogglyClient,
  type EvaluationContext,
} from '@ops-ai/toggly-node-core'
import type {
  TogglyHonoConfig,
  FeatureGateOptions,
  FeatureRouteOptions,
} from './types.js'

// Module-level client singleton
let honoClient: TogglyClient | null = null

/**
 * Get the Hono Toggly client
 */
export function getHonoToggly(): TogglyClient | null {
  return honoClient
}

/**
 * Get identity from Hono context
 */
async function extractIdentity(
  c: Context,
  config: TogglyHonoConfig
): Promise<string | undefined> {
  // Use custom extractor if provided
  if (config.getIdentity) {
    return config.getIdentity(c)
  }

  // Default: check header
  const headerIdentity = c.req.header('x-toggly-identity')
  if (headerIdentity) {
    return headerIdentity
  }

  return undefined
}

/**
 * Collect segment-relevant headers from a Hono request
 */
function segmentHeaders(c: Context): Record<string, string | undefined> {
  const headerBag: Record<string, string | undefined> = {}
  for (const name of [
    'user-agent',
    'accept-language',
    'cf-ipcountry',
    'x-vercel-ip-country',
    'cloudfront-viewer-country',
  ]) {
    headerBag[name] = c.req.header(name)
  }
  return headerBag
}

/**
 * Get evaluation context from Hono context
 */
async function extractContext(
  c: Context,
  config: TogglyHonoConfig
): Promise<EvaluationContext> {
  const headerBag = segmentHeaders(c)
  const headerRequest = fromHttpRequest(headerBag).request

  // Custom full context: use returned fields, fill missing request from headers
  if (config.getContext) {
    const custom = await config.getContext(c)
    return {
      ...custom,
      request: custom.request ?? headerRequest,
    }
  }

  // Default: identity / groups / claims providers + segment request headers
  const identity = await extractIdentity(c, config)
  const groups = config.getGroups ? await config.getGroups(c) : undefined
  const claims = config.getClaims ? await config.getClaims(c) : undefined
  const fromReq = fromHttpRequest(headerBag, { identity, groups, claims })

  return {
    identity: fromReq.identity,
    groups: fromReq.groups,
    claims: fromReq.claims,
    request: fromReq.request,
    traits: {
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
      path: c.req.path,
      method: c.req.method,
    },
  }
}

/**
 * Create Toggly middleware for Hono
 *
 * This middleware:
 * 1. Initializes the Toggly client (if not already initialized)
 * 2. Attaches feature flag helpers to the context
 * 3. Extracts identity and context from the request
 */
export function togglyMiddleware(config: TogglyHonoConfig): MiddlewareHandler {
  // Initialize client lazily
  let initPromise: Promise<void> | null = null

  const initialize = async () => {
    if (!honoClient) {
      honoClient = createTogglyClient(config)
      await honoClient.init()
    }
  }

  return async (c: Context, next) => {
    // Ensure client is initialized
    if (!initPromise) {
      initPromise = initialize()
    }
    await initPromise

    if (!honoClient) {
      throw new Error('Toggly client failed to initialize')
    }

    // Extract context from request
    const evalContext = await extractContext(c, config)
    const identity = evalContext.identity

    // Attach Toggly helpers to Hono context
    c.set('toggly', {
      client: honoClient,
      features: honoClient.state.features,
      identity,
      context: evalContext,
      isFeatureOn: (featureKey: string) => honoClient!.isFeatureOn(featureKey, evalContext),
      isFeatureOff: (featureKey: string) => honoClient!.isFeatureOff(featureKey, evalContext),
      evaluateFeatureGate: (featureKeys, requirement, negate) =>
        honoClient!.evaluateFeatureGate(featureKeys, requirement, negate, evalContext),
    })

    await next()
  }
}

/**
 * Create a feature gate middleware
 *
 * Protects routes by checking if specified features are enabled
 */
export function featureGate(options: FeatureGateOptions): MiddlewareHandler {
  const {
    featureKey,
    requirement = 'all',
    negate = false,
    onDisabled,
    redirectTo,
    redirectStatus = 302,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return async (c: Context, next) => {
    const toggly = c.get('toggly')

    if (!toggly) {
      throw new Error('Toggly middleware must be applied before featureGate')
    }

    const isEnabled = await toggly.evaluateFeatureGate(featureKeys, requirement, negate)

    if (isEnabled) {
      await next()
      return
    }

    // Feature is disabled
    if (redirectTo) {
      return c.redirect(redirectTo, redirectStatus)
    }

    if (onDisabled) {
      return onDisabled(c)
    }

    // Default: 404
    return c.json(
      {
        error: 'Not Found',
        message: 'The requested resource is not available',
      },
      404
    )
  }
}

/**
 * Create middleware that applies feature gates based on route patterns
 */
export function featureRoutes(routes: FeatureRouteOptions[]): MiddlewareHandler {
  return async (c: Context, next) => {
    for (const route of routes) {
      // Check if route matches
      const pathMatches =
        typeof route.path === 'string'
          ? c.req.path === route.path || c.req.path.startsWith(route.path)
          : route.path.test(c.req.path)

      if (!pathMatches) {
        continue
      }

      // Check if method matches
      if (route.methods && !route.methods.includes(c.req.method.toUpperCase())) {
        continue
      }

      // Apply feature gate
      const gate = featureGate(route)
      return gate(c, next)
    }

    // No matching route, continue
    await next()
  }
}

/**
 * Create a route handler that only executes if feature is enabled
 */
export function withFeature(
  featureKey: string | string[],
  handler: Handler,
  options: Omit<FeatureGateOptions, 'featureKey'> = {}
): MiddlewareHandler {
  const {
    requirement = 'all',
    negate = false,
    onDisabled,
    redirectTo,
    redirectStatus = 302,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return async (c: Context, next) => {
    const toggly = c.get('toggly')

    if (!toggly) {
      throw new Error('Toggly middleware must be applied before withFeature')
    }

    const isEnabled = await toggly.evaluateFeatureGate(featureKeys, requirement, negate)

    if (isEnabled) {
      // Execute the handler
      return handler(c, next)
    }

    // Feature is disabled
    if (redirectTo) {
      return c.redirect(redirectTo, redirectStatus)
    }

    if (onDisabled) {
      return onDisabled(c)
    }

    // Default: 404
    return c.json(
      {
        error: 'Not Found',
        message: 'The requested resource is not available',
      },
      404
    )
  }
}

/**
 * Get features handler for Hono
 */
export const featuresHandler: Handler = async (c: Context) => {
  const toggly = c.get('toggly')

  if (!toggly) {
    return c.json(
      {
        error: 'Internal Server Error',
        message: 'Toggly middleware not configured',
      },
      500
    )
  }

  return c.json({
    features: toggly.features,
    identity: toggly.identity,
  })
}

/**
 * Close the Hono Toggly client
 */
export function closeHonoToggly(): void {
  if (honoClient) {
    honoClient.close()
    honoClient = null
  }
}
