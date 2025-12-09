/**
 * Feature flag fetching and caching utilities
 * 
 * Uses @ops-ai/toggly-client-core to fetch flags and implements edge-side caching
 * using Cloudflare's cache API.
 */

import { createTogglyClient, type TogglyConfig } from '@ops-ai/toggly-client-core';
import type { RequestContext, Env } from './types';

const FLAGS_CACHE_TTL_SECONDS = 30; // 30 seconds

/**
 * Generate a cache key for flags based on context
 */
function getFlagsCacheKey(context: RequestContext): string {
  // For now, we use a simple key since context is empty
  // In the future, this can include user/tenant IDs
  const contextKey = JSON.stringify(context);
  return `flags:${contextKey}`;
}

/**
 * Get feature flags for the given context
 * Uses both @ops-ai/toggly-client-core's in-memory cache and Cloudflare's cache API
 */
export async function getFlags(
  env: Env,
  context: RequestContext,
  cache: Cache | null
): Promise<Record<string, boolean>> {
  const config: TogglyConfig = {
    baseURI: env.TOGGLY_API_BASE_URL,
    appKey: env.TOGGLY_APP_KEY,
    environment: env.TOGGLY_ENVIRONMENT,
    fetch: globalThis.fetch, // Use Cloudflare's fetch
  };

  // Check Cloudflare cache first
  const cacheKey = getFlagsCacheKey(context);
  const cacheRequest = new Request(`https://toggly-cache/${cacheKey}`);
  
  if (cache) {
    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
      const flags = (await cachedResponse.json()) as Record<string, boolean>;
      return flags;
    }
  }

  // Fetch flags using @ops-ai/toggly-client-core
  const client = createTogglyClient(config);
  const flags = await client.getFlags();

  // Store in Cloudflare cache
  if (cache) {
    const response = new Response(JSON.stringify(flags), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${FLAGS_CACHE_TTL_SECONDS}`,
      },
    });
    // Note: In Cloudflare Workers, cache.put is fire-and-forget
    cache.put(cacheRequest, response);
  }

  return flags;
}

/**
 * Check if a specific feature flag is enabled
 */
export async function isFeatureEnabled(
  flagKey: string,
  env: Env,
  context: RequestContext,
  cache: Cache | null
): Promise<boolean> {
  const flags = await getFlags(env, context, cache);
  return flags[flagKey] ?? false;
}
