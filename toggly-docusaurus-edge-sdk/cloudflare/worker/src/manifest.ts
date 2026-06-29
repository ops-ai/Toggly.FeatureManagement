/**
 * Manifest loading and caching utilities
 * 
 * Loads the toggly-page-features.json manifest from the origin
 * and caches it in memory and in Cloudflare's cache.
 */

import type { PageFeatureMapping, Env } from './types';
import { fetchFromOrigin } from './origin';

// In-memory cache for the manifest
let manifestCache: PageFeatureMapping | null = null;
let manifestCacheTimestamp: number = 0;

const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load the page feature manifest from the origin
 */
async function fetchManifest(env: Env): Promise<PageFeatureMapping> {
  const manifestUrl = new URL('/toggly-page-features.json', env.ORIGIN_BASE_URL);

  const response = await fetchFromOrigin(
    manifestUrl.toString(),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
    env,
  );

  if (!response.ok) {
    console.warn(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
    return {};
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    console.warn(`Manifest response is not JSON (${contentType})`);
    return {};
  }

  try {
    const manifest = (await response.json()) as PageFeatureMapping;
    return manifest;
  } catch (error) {
    console.warn('Failed to parse manifest JSON', error);
    return {};
  }
}

/**
 * Get the page feature manifest, using cache when available
 */
export async function getManifest(
  env: Env,
  cache: Cache | null
): Promise<PageFeatureMapping> {
  const now = Date.now();

  // Check in-memory cache first
  if (manifestCache && now - manifestCacheTimestamp < MANIFEST_CACHE_TTL_MS) {
    return manifestCache;
  }

  // Check Cloudflare cache
  const cacheKey = new Request(new URL('/toggly-page-features.json', env.ORIGIN_BASE_URL));
  if (cache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const manifest = (await cachedResponse.json()) as PageFeatureMapping;
      // Update in-memory cache
      manifestCache = manifest;
      manifestCacheTimestamp = now;
      return manifest;
    }
  }

  // Fetch from origin
  const manifest = await fetchManifest(env);

  // Update in-memory cache
  manifestCache = manifest;
  manifestCacheTimestamp = now;

  // Store in Cloudflare cache
  if (cache) {
    const response = new Response(JSON.stringify(manifest), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${300}`, // 5 minutes
      },
    });
    // Note: In Cloudflare Workers, we can't use ctx.waitUntil here
    // The cache.put is fire-and-forget
    cache.put(cacheKey, response);
  }

  return manifest;
}

/**
 * Get the feature key for a given path from the manifest
 */
export async function getFeatureKeyForPath(
  path: string,
  env: Env,
  cache: Cache | null
): Promise<string | null> {
  const manifest = await getManifest(env, cache);
  
  // Try exact match first
  if (manifest[path]) {
    return manifest[path];
  }

  // Try with trailing slash
  const pathWithSlash = path.endsWith('/') ? path : path + '/';
  if (manifest[pathWithSlash]) {
    return manifest[pathWithSlash];
  }

  // Try without trailing slash
  const pathWithoutSlash = path.endsWith('/') ? path.slice(0, -1) : path;
  if (manifest[pathWithoutSlash]) {
    return manifest[pathWithoutSlash];
  }

  return null;
}
