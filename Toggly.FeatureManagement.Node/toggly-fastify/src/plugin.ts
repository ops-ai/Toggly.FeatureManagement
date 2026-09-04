import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyPluginAsync,
} from 'fastify'

// Custom type for preHandler hooks (simpler than Fastify's complex generic type)
type PreHandlerHook = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<unknown>
import fp from 'fastify-plugin'
import {
  createTogglyClient,
  normalizeFeatureKeys,
  fromHttpRequest,
  type TogglyClient,
  type EvaluationContext,
} from '@ops-ai/toggly-node-core'
import type {
  TogglyFastifyConfig,
  FeatureGateOptions,
  FeatureRouteOptions,
} from './types.js'

// Module-level client singleton
let fastifyClient: TogglyClient | null = null

/**
 * Get the Fastify Toggly client
 */
export function getFastifyToggly(): TogglyClient | null {
  return fastifyClient
}

/**
 * Get identity from request
 */
async function extractIdentity(
  request: FastifyRequest,
  config: TogglyFastifyConfig
): Promise<string | undefined> {
  // Use custom extractor if provided
  if (config.getIdentity) {
    return config.getIdentity(request)
  }

  // Default: check header
  const headerIdentity = request.headers['x-toggly-identity']
  if (typeof headerIdentity === 'string') {
    return headerIdentity
  }

  return undefined
}

/**
 * Get evaluation context from request
 */
async function extractContext(
  request: FastifyRequest,
  config: TogglyFastifyConfig
): Promise<EvaluationContext> {
  // Use custom extractor if provided
  if (config.getContext) {
    return config.getContext(request)
  }

  // Default: extract basic context + segment request headers
  const identity = await extractIdentity(request, config)
  const fromReq = fromHttpRequest(
    request.headers as Record<string, string | string[] | undefined>,
    { identity },
  )

  return {
    identity: fromReq.identity,
    groups: fromReq.groups,
    request: fromReq.request,
    traits: {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      path: request.url,
      method: request.method,
    },
  }
}

/**
 * Toggly Fastify plugin
 *
 * This plugin:
 * 1. Initializes the Toggly client
 * 2. Attaches feature flag helpers to the request object
 * 3. Extracts identity and context from the request
 */
const togglyPluginAsync: FastifyPluginAsync<TogglyFastifyConfig> = async (
  fastify: FastifyInstance,
  config: TogglyFastifyConfig
) => {
  // Initialize client
  if (!fastifyClient) {
    fastifyClient = createTogglyClient(config)
    await fastifyClient.init()
  }

  // Add hook to attach toggly to request
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    if (!fastifyClient) {
      throw new Error('Toggly client not initialized')
    }

    // Extract context from request
    const context = await extractContext(request, config)
    const identity = context.identity

    // Attach Toggly helpers to request
    request.toggly = {
      client: fastifyClient,
      features: fastifyClient.state.features,
      identity,
      context,
      isFeatureOn: (featureKey: string) => fastifyClient!.isFeatureOn(featureKey, context),
      isFeatureOff: (featureKey: string) => fastifyClient!.isFeatureOff(featureKey, context),
      evaluateFeatureGate: (featureKeys, requirement, negate) =>
        fastifyClient!.evaluateFeatureGate(featureKeys, requirement, negate, context),
    }
  })

  // Close client when fastify closes
  fastify.addHook('onClose', async () => {
    closeFastifyToggly()
  })
}

/**
 * Toggly Fastify plugin with proper encapsulation
 */
export const togglyPlugin = fp(togglyPluginAsync, {
  name: '@ops-ai/toggly-fastify',
  fastify: '>=4.0.0',
})

/**
 * Create a feature gate preHandler hook
 *
 * Protects routes by checking if specified features are enabled
 */
export function featureGate(options: FeatureGateOptions): PreHandlerHook {
  const {
    featureKey,
    requirement = 'all',
    negate = false,
    onDisabled,
    redirectTo,
    redirectStatus = 302,
  } = options

  const featureKeys = normalizeFeatureKeys(featureKey)

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.toggly) {
      throw new Error('Toggly plugin must be registered before using featureGate')
    }

    const isEnabled = await request.toggly.evaluateFeatureGate(featureKeys, requirement, negate)

    if (isEnabled) {
      return // Continue to handler
    }

    // Feature is disabled
    if (redirectTo) {
      return reply.redirect(redirectTo, redirectStatus)
    }

    if (onDisabled) {
      await onDisabled(request)
      return
    }

    // Default: 404
    return reply.status(404).send({
      error: 'Not Found',
      message: 'The requested resource is not available',
    })
  }
}

/**
 * Create preHandler that applies feature gates based on route patterns
 */
export function featureRoutes(routes: FeatureRouteOptions[]): PreHandlerHook {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    for (const route of routes) {
      // Check if route matches
      const pathMatches =
        typeof route.path === 'string'
          ? request.url === route.path || request.url.startsWith(route.path)
          : route.path.test(request.url)

      if (!pathMatches) {
        continue
      }

      // Check if method matches
      if (route.methods && !route.methods.includes(request.method.toUpperCase())) {
        continue
      }

      // Apply feature gate
      const gate = featureGate(route)
      return gate(request, reply)
    }

    // No matching route, continue
    return
  }
}

/**
 * Create a decorated route handler that checks features
 */
export function withFeature(
  featureKey: string | string[],
  options: Omit<FeatureGateOptions, 'featureKey'> = {}
): PreHandlerHook {
  return featureGate({ featureKey, ...options })
}

/**
 * Get features route handler
 */
export async function featuresHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.toggly) {
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Toggly plugin not configured',
    })
  }

  return reply.send({
    features: request.toggly.features,
    identity: request.toggly.identity,
  })
}

/**
 * Close the Fastify Toggly client
 */
export function closeFastifyToggly(): void {
  if (fastifyClient) {
    fastifyClient.close()
    fastifyClient = null
  }
}
