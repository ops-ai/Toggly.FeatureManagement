import { unstable_cache } from 'next/cache'
import { getServerToggly } from './server-client'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'

/**
 * Cache tags for feature flags
 */
export const FEATURE_CACHE_TAG = 'toggly-features'

/**
 * Create a cache key for a feature
 */
export function createFeatureCacheKey(
  featureKey: string,
  identity?: string
): string {
  const base = `toggly:feature:${featureKey}`
  return identity ? `${base}:${identity}` : base
}

/**
 * Cached feature check with Next.js cache
 *
 * @example
 * ```tsx
 * // In a Server Component
 * import { cachedIsFeatureOn } from '@ops-ai/nextjs-toggly-server'
 *
 * export default async function Page() {
 *   // This result is cached and can be revalidated
 *   const isEnabled = await cachedIsFeatureOn('new-feature', {
 *     revalidate: 60, // Revalidate every 60 seconds
 *   })
 *
 *   return isEnabled ? <NewFeature /> : <OldFeature />
 * }
 * ```
 */
export function cachedIsFeatureOn(
  featureKey: string,
  options: {
    identity?: string
    revalidate?: number | false
    tags?: string[]
  } = {}
): Promise<boolean> {
  const { identity, revalidate = 60, tags = [] } = options

  const cached = unstable_cache(
    async () => {
      const client = getServerToggly()
      if (!client) {
        return false
      }

      if (identity) {
        client.identity = identity
      }

      return client.isFeatureOn(featureKey)
    },
    [createFeatureCacheKey(featureKey, identity)],
    {
      revalidate,
      tags: [FEATURE_CACHE_TAG, `feature:${featureKey}`, ...tags],
    }
  )

  return cached()
}

/**
 * Cached feature gate evaluation
 */
export function cachedEvaluateFeatureGate(
  featureKeys: string[],
  options: {
    requirement?: FeatureRequirement
    negate?: boolean
    identity?: string
    revalidate?: number | false
    tags?: string[]
  } = {}
): Promise<boolean> {
  const {
    requirement = 'all',
    negate = false,
    identity,
    revalidate = 60,
    tags = [],
  } = options

  const cacheKey = `toggly:gate:${featureKeys.join(',')}:${requirement}:${negate}:${identity || 'anonymous'}`

  const cached = unstable_cache(
    async () => {
      const client = getServerToggly()
      if (!client) {
        return negate
      }

      if (identity) {
        client.identity = identity
      }

      return client.evaluateFeatureGate(featureKeys, requirement, negate)
    },
    [cacheKey],
    {
      revalidate,
      tags: [
        FEATURE_CACHE_TAG,
        ...featureKeys.map((k) => `feature:${k}`),
        ...tags,
      ],
    }
  )

  return cached()
}

/**
 * Get all features with caching
 */
export function cachedGetFeatures(options: {
  revalidate?: number | false
  tags?: string[]
} = {}): Promise<Record<string, boolean>> {
  const { revalidate = 60, tags = [] } = options

  const cached = unstable_cache(
    async () => {
      const client = getServerToggly()
      if (!client) {
        return {}
      }

      return { ...client.state.features }
    },
    ['toggly:all-features'],
    {
      revalidate,
      tags: [FEATURE_CACHE_TAG, ...tags],
    }
  )

  return cached()
}
