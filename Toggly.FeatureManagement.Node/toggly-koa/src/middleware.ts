import type { Context, Middleware, Next } from 'koa'
import {
  createTogglyClient,
  normalizeFeatureKeys,
  fromHttpRequest,
  type TogglyClient,
  type EvaluationContext,
} from '@ops-ai/toggly-node-core'
import type {
  TogglyKoaConfig,
  FeatureGateOptions,
  FeatureRouteOptions,
} from './types.js'

// Module-level client singleton
let koaClient: TogglyClient | null = null

/**
 * Get the Koa Toggly client
 */
export function getKoaToggly(): TogglyClient | null {
  return koaClient
}

/**
 * Get identity from Koa context
 */
async function extractIdentity(
  ctx: Context,
  config: TogglyKoaConfig
): Promise<string | undefined> {
  // Use custom extractor if provided
  if (config.getIdentity) {
    return config.getIdentity(ctx)
  }

  // Default: check header
  const headerIdentity = ctx.get('x-toggly-identity')
  if (headerIdentity) {
    return headerIdentity
  }

  return undefined
}

/**
 * Get evaluation context from Koa context
 */
async function extractContext(
  ctx: Context,
  config: TogglyKoaConfig
): Promise<EvaluationContext> {
  // Use custom extractor if provided
  if (config.getContext) {
    return config.getContext(ctx)
  }

  // Default: extract basic context + segment request headers
  const identity = await extractIdentity(ctx, config)
  const fromReq = fromHttpRequest(
    ctx.headers as Record<string, string | string[] | undefined>,
    { identity },
  )

  return {
    identity: fromReq.identity,
    groups: fromReq.groups,
    request: fromReq.request,
    traits: {
      ip: ctx.ip,
      userAgent: ctx.get('user-agent'),
      path: ctx.path,
      method: ctx.method,
    },
  }
}

/**
 * Create Toggly middleware for Koa
 *
 * This middleware:
 * 1. Initializes the Toggly client (if not already initialized)
 * 2. Attaches feature flag helpers to the context state
 * 3. Extracts identity and context from the request
 */
export function togglyMiddleware(config: TogglyKoaConfig): Middleware {
  // Initialize client lazily
  let initPromise: Promise<void> | null = null

  const initialize = async () => {
    if (!koaClient) {
      koaClient = createTogglyClient(config)
      await koaClient.init()
    }
  }

  return async (ctx: Context, next: Next) => {
    // Ensure client is initialized
    if (!initPromise) {
      initPromise = initialize()
    }
    await initPromise

    if (!koaClient) {
      throw new Error('Toggly client failed to initialize')
    }

    // Extract context from request
    const evalContext = await extractContext(ctx, config)
    const identity = evalContext.identity

    // Attach Toggly helpers to Koa context state
    ctx.state.toggly = {
      client: koaClient,
      features: koaClient.state.features,
      identity,
      context: evalContext,
      isFeatureOn: (featureKey: string) => koaClient!.isFeatureOn(featureKey, evalContext),
      isFeatureOff: (featureKey: string) => koaClient!.isFeatureOff(featureKey, evalContext),
      evaluateFeatureGate: (featureKeys, requirement, negate) =>
        koaClient!.evaluateFeatureGate(featureKeys, requirement, negate, evalContext),
    }

    await next()
  }
}

/**
 * Create a feature gate middleware
 *
 * Protects routes by checking if specified features are enabled
 */
export function featureGate(options: FeatureGateOptions): Middleware {
  const {
    featureKey,
    requirement = 'all',
    negate = false,
    onDisabled,
    redirectTo,
    redirectStatus = 302,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return async (ctx: Context, next: Next) => {
    const toggly = ctx.state.toggly

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
      ctx.redirect(redirectTo)
      ctx.status = redirectStatus
      return
    }

    if (onDisabled) {
      await onDisabled(ctx)
      return
    }

    // Default: 404
    ctx.status = 404
    ctx.body = {
      error: 'Not Found',
      message: 'The requested resource is not available',
    }
  }
}

/**
 * Create middleware that applies feature gates based on route patterns
 */
export function featureRoutes(routes: FeatureRouteOptions[]): Middleware {
  return async (ctx: Context, next: Next) => {
    for (const route of routes) {
      // Check if route matches
      const pathMatches =
        typeof route.path === 'string'
          ? ctx.path === route.path || ctx.path.startsWith(route.path)
          : route.path.test(ctx.path)

      if (!pathMatches) {
        continue
      }

      // Check if method matches
      if (route.methods && !route.methods.includes(ctx.method.toUpperCase())) {
        continue
      }

      // Apply feature gate
      const gate = featureGate(route)
      await gate(ctx, next)
      return
    }

    // No matching route, continue
    await next()
  }
}

/**
 * Create a middleware that only executes the handler if feature is enabled
 */
export function withFeature(
  featureKey: string | string[],
  handler: Middleware,
  options: Omit<FeatureGateOptions, 'featureKey'> = {}
): Middleware {
  const gate = featureGate({ featureKey, ...options })

  return async (ctx: Context, next: Next) => {
    await gate(ctx, async () => {
      await handler(ctx, next)
    })
  }
}

/**
 * Get features handler for Koa
 */
export function featuresHandler(): Middleware {
  return async (ctx: Context) => {
    const toggly = ctx.state.toggly

    if (!toggly) {
      ctx.status = 500
      ctx.body = {
        error: 'Internal Server Error',
        message: 'Toggly middleware not configured',
      }
      return
    }

    ctx.body = {
      features: toggly.features,
      identity: toggly.identity,
    }
  }
}

/**
 * Close the Koa Toggly client
 */
export function closeKoaToggly(): void {
  if (koaClient) {
    koaClient.close()
    koaClient = null
  }
}
