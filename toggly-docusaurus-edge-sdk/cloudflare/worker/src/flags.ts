/**
 * Feature flag fetching and edge-side caching.
 *
 * Calls Toggly's `evaluated-signed` endpoint directly with a hard timeout and
 * caches the response in `caches.default`. Inlined here (rather than going
 * through `@ops-ai/toggly-client-core`) so the Worker template ships with no
 * npm runtime dependencies, which keeps `wrangler deploy` green for users
 * regardless of whatever conditional-`exports` map the published core has at
 * any given moment. The actual fetch logic is small enough that a private
 * implementation is the right trade-off for an edge runtime.
 */

import type { RequestContext, Env } from './types';

const FLAGS_CACHE_TTL_SECONDS = 30;
const FLAGS_FETCH_TIMEOUT_MS = 5_000;
const FLAGS_MEMORY_CACHE_TTL_MS = FLAGS_CACHE_TTL_SECONDS * 1000;

/** Map of feature flag keys to their boolean values. */
type Flags = Record<string, boolean>;

/**
 * Shape of the `evaluated-signed` endpoint response. The API has historically
 * returned either a bare flag map or `{ defs: <flag map> }`; we accept both.
 */
interface TogglyApiPayload {
  defs?: Flags;
  [key: string]: unknown;
}

// In-memory last-known-good cache for flags within the isolate.
let flagsMemoryCache: Flags | null = null;
let flagsMemoryCacheTimestamp = 0;

/**
 * Generate a cache key for flags based on context.
 * Currently context is empty so the key collapses to a constant per
 * (app key, environment) pair, but keeping the parameter makes it easy to
 * include user / tenant identifiers later.
 */
function getFlagsCacheKey(env: Env, context: RequestContext): string {
  const contextKey = JSON.stringify(context);
  return `flags:${encodeURIComponent(env.TOGGLY_APP_KEY)}:${encodeURIComponent(env.TOGGLY_ENVIRONMENT)}:${contextKey}`;
}

/**
 * Fetch flags from Toggly's `evaluated-signed` endpoint with a hard timeout.
 * Throws on transient failures so callers do not poison edge cache with
 * fallback/default values.
 */
async function fetchFlagsFromTogglyApi(env: Env): Promise<Flags> {
  if (!env.TOGGLY_APP_KEY || !env.TOGGLY_API_BASE_URL || !env.TOGGLY_ENVIRONMENT) {
    return {};
  }

  const baseUrl = env.TOGGLY_API_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/evaluated-signed/${encodeURIComponent(env.TOGGLY_APP_KEY)}/${encodeURIComponent(env.TOGGLY_ENVIRONMENT)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAGS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch flags: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as TogglyApiPayload | Flags;
    const defs = (payload as TogglyApiPayload).defs;
    return (defs ?? (payload as Flags)) as Flags;
  } finally {
    clearTimeout(timer);
  }
}

function updateFlagsMemoryCache(flags: Flags): void {
  if (Object.keys(flags).length > 0) {
    flagsMemoryCache = flags;
    flagsMemoryCacheTimestamp = Date.now();
  }
}

/**
 * Get feature flags for the given context, using `caches.default` to amortise
 * Toggly API calls across requests handled by the same edge isolate.
 */
export async function getFlags(
  env: Env,
  context: RequestContext,
  cache: Cache | null,
): Promise<Flags> {
  const now = Date.now();

  if (flagsMemoryCache && now - flagsMemoryCacheTimestamp < FLAGS_MEMORY_CACHE_TTL_MS) {
    return flagsMemoryCache;
  }

  const cacheKey = getFlagsCacheKey(env, context);
  const cacheRequest = new Request(`https://toggly-cache/${cacheKey}`);

  if (cache) {
    const cachedResponse = await cache.match(cacheRequest);
    if (cachedResponse) {
      const flags = (await cachedResponse.json()) as Flags;
      updateFlagsMemoryCache(flags);
      return flags;
    }
  }

  let flags: Flags;
  try {
    flags = await fetchFlagsFromTogglyApi(env);
  } catch (error) {
    console.error('[Toggly Docusaurus Edge] Failed to fetch flags:', error);
    return flagsMemoryCache ?? {};
  }

  updateFlagsMemoryCache(flags);

  if (cache && Object.keys(flags).length > 0) {
    const response = new Response(JSON.stringify(flags), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${FLAGS_CACHE_TTL_SECONDS}`,
      },
    });
    // `cache.put` is fire-and-forget in the Workers runtime.
    cache.put(cacheRequest, response);
  }

  return flags;
}

/** Convenience helper: returns false when the flag is unset or disabled. */
export async function isFeatureEnabled(
  flagKey: string,
  env: Env,
  context: RequestContext,
  cache: Cache | null,
): Promise<boolean> {
  const flags = await getFlags(env, context, cache);
  return flags[flagKey] ?? false;
}
