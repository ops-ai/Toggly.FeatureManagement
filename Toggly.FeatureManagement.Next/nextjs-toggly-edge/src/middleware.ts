import { NextResponse, type NextRequest, type NextMiddleware } from 'next/server'
import { normalizeFeatureKeys } from '@ops-ai/nextjs-toggly-core'
import { getEdgeToggly, initEdgeToggly } from './edge-client'
import type {
  TogglyEdgeConfig,
  MiddlewareFeatureOptions,
  FeatureMiddlewareHandler,
  FeatureMiddlewareContext,
  FeaturePathMatcher,
} from './types'

/**
 * Create a feature flag middleware
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { createFeatureMiddleware } from '@ops-ai/nextjs-toggly-edge'
 *
 * const featureMiddleware = createFeatureMiddleware({
 *   appKey: process.env.TOGGLY_APP_KEY!,
 *   environment: 'Production',
 * })
 *
 * export async function middleware(request: NextRequest) {
 *   return featureMiddleware(request, {
 *     featureKey: 'beta-feature',
 *     redirectTo: '/coming-soon',
 *   })
 * }
 * ```
 */
export function createFeatureMiddleware(
  config: TogglyEdgeConfig
): (
  request: NextRequest,
  options: MiddlewareFeatureOptions
) => Promise<NextResponse | Response> {
  return async (
    request: NextRequest,
    options: MiddlewareFeatureOptions
  ): Promise<NextResponse | Response> => {
    let client = getEdgeToggly()

    if (!client) {
      client = await initEdgeToggly(config)
    }

    // Get identity from request
    const identity = getIdentityFromRequest(request, config)
    if (identity) {
      client.identity = identity
    }

    // Ensure features are loaded
    await client.init()

    const featureKeys = normalizeFeatureKeys(options.featureKey)
    const isEnabled = client.evaluateFeatureGateSync(
      featureKeys,
      options.requirement ?? 'all',
      options.negate ?? false
    )

    if (!isEnabled) {
      // Handle disabled feature
      if (options.onDisabled) {
        return options.onDisabled(request)
      }

      if (options.redirectTo) {
        const url = new URL(options.redirectTo, request.url)
        return NextResponse.redirect(url, {
          status: options.redirectStatus ?? 307,
        })
      }

      if (options.rewriteTo) {
        const url = new URL(options.rewriteTo, request.url)
        return NextResponse.rewrite(url)
      }

      // Default: return 404
      return new NextResponse('Feature not available', { status: 404 })
    }

    return NextResponse.next()
  }
}

/**
 * Create a middleware that applies feature gates to multiple paths
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { createPathFeatureMiddleware } from '@ops-ai/nextjs-toggly-edge'
 *
 * export const middleware = createPathFeatureMiddleware({
 *   config: {
 *     appKey: process.env.TOGGLY_APP_KEY!,
 *   },
 *   routes: [
 *     {
 *       path: '/beta/*',
 *       feature: { featureKey: 'beta-access', redirectTo: '/waitlist' },
 *     },
 *     {
 *       path: '/admin/*',
 *       feature: { featureKey: 'admin-access', redirectTo: '/unauthorized' },
 *     },
 *   ],
 * })
 * ```
 */
export function createPathFeatureMiddleware(options: {
  config: TogglyEdgeConfig
  routes: FeaturePathMatcher[]
  fallthrough?: NextMiddleware
}): NextMiddleware {
  const { config, routes, fallthrough } = options

  return async (request) => {
    const pathname = request.nextUrl.pathname

    // Find matching route
    for (const route of routes) {
      const matches =
        typeof route.path === 'string'
          ? matchPath(pathname, route.path)
          : route.path.test(pathname)

      if (matches) {
        const featureMiddleware = createFeatureMiddleware(config)
        return featureMiddleware(request, route.feature)
      }
    }

    // No matching route, continue or use fallthrough
    if (fallthrough) {
      return fallthrough(request, { waitUntil: () => {} } as any)
    }

    return NextResponse.next()
  }
}

/**
 * Higher-order function to wrap existing middleware with feature gates
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { withFeatureGate } from '@ops-ai/nextjs-toggly-edge'
 *
 * const myMiddleware = async (request: NextRequest) => {
 *   // Your existing middleware logic
 *   return NextResponse.next()
 * }
 *
 * export const middleware = withFeatureGate(myMiddleware, {
 *   config: { appKey: process.env.TOGGLY_APP_KEY! },
 *   featureKey: 'middleware-feature',
 *   onDisabled: (request) => NextResponse.redirect(new URL('/disabled', request.url)),
 * })
 * ```
 */
export function withFeatureGate(
  middleware: NextMiddleware,
  options: {
    config: TogglyEdgeConfig
    featureKey: string | string[]
    requirement?: 'all' | 'any'
    negate?: boolean
    onDisabled?: (request: NextRequest) => NextResponse | Response
  }
): NextMiddleware {
  return async (request) => {
    let client = getEdgeToggly()

    if (!client) {
      client = await initEdgeToggly(options.config)
    }

    // Get identity from request
    const identity = getIdentityFromRequest(request, options.config)
    if (identity) {
      client.identity = identity
    }

    await client.init()

    const featureKeys = normalizeFeatureKeys(options.featureKey)
    const isEnabled = client.evaluateFeatureGateSync(
      featureKeys,
      options.requirement ?? 'all',
      options.negate ?? false
    )

    if (!isEnabled) {
      if (options.onDisabled) {
        return options.onDisabled(request)
      }
      return new NextResponse('Feature not available', { status: 404 })
    }

    return middleware(request, { waitUntil: () => {} } as any)
  }
}

/**
 * Create a middleware handler with feature context
 *
 * @example
 * ```ts
 * import { createFeatureHandler } from '@ops-ai/nextjs-toggly-edge'
 *
 * export const middleware = createFeatureHandler({
 *   config: { appKey: process.env.TOGGLY_APP_KEY! },
 *   handler: async (request, context) => {
 *     if (context.isEnabled) {
 *       // Feature is enabled
 *       return NextResponse.next()
 *     }
 *     return NextResponse.redirect(new URL('/disabled', request.url))
 *   },
 *   featureKey: 'my-feature',
 * })
 * ```
 */
export function createFeatureHandler(options: {
  config: TogglyEdgeConfig
  handler: FeatureMiddlewareHandler
  featureKey: string | string[]
  requirement?: 'all' | 'any'
  negate?: boolean
}): NextMiddleware {
  return async (request) => {
    let client = getEdgeToggly()

    if (!client) {
      client = await initEdgeToggly(options.config)
    }

    const identity = getIdentityFromRequest(request, options.config)
    if (identity) {
      client.identity = identity
    }

    await client.init()

    const featureKeys = normalizeFeatureKeys(options.featureKey)
    const isEnabled = client.evaluateFeatureGateSync(
      featureKeys,
      options.requirement ?? 'all',
      options.negate ?? false
    )

    const context: FeatureMiddlewareContext = {
      isEnabled,
      featureKeys,
      features: client.getFeatures(),
      identity: client.identity,
    }

    return options.handler(request, context)
  }
}

/**
 * Extract identity from request
 */
function getIdentityFromRequest(
  request: NextRequest,
  config: TogglyEdgeConfig
): string | undefined {
  // Check header
  const headerIdentity = request.headers.get('x-toggly-identity')
  if (headerIdentity) {
    return headerIdentity
  }

  // Check cookie
  const cookieIdentity = request.cookies.get('toggly-identity')?.value
  if (cookieIdentity) {
    return cookieIdentity
  }

  // Use config identity
  return config.identity
}

/**
 * Simple path matching with wildcard support
 */
function matchPath(pathname: string, pattern: string): boolean {
  if (pattern === pathname) {
    return true
  }

  // Handle wildcard patterns
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return pathname === prefix || pathname.startsWith(prefix + '/')
  }

  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return pathname === prefix || pathname.startsWith(prefix + '/')
  }

  return false
}

/**
 * Check if a feature is enabled for a request
 * Utility function for use in custom middleware
 */
export async function isFeatureEnabledForRequest(
  request: NextRequest,
  featureKey: string,
  config: TogglyEdgeConfig
): Promise<boolean> {
  let client = getEdgeToggly()

  if (!client) {
    client = await initEdgeToggly(config)
  }

  const identity = getIdentityFromRequest(request, config)
  if (identity) {
    client.identity = identity
  }

  await client.init()

  return client.isFeatureOnSync(featureKey)
}

/**
 * Get all features for a request
 * Utility function for use in custom middleware
 */
export async function getFeaturesForRequest(
  request: NextRequest,
  config: TogglyEdgeConfig
): Promise<Record<string, boolean>> {
  let client = getEdgeToggly()

  if (!client) {
    client = await initEdgeToggly(config)
  }

  const identity = getIdentityFromRequest(request, config)
  if (identity) {
    client.identity = identity
  }

  await client.init()

  return client.getFeatures()
}
