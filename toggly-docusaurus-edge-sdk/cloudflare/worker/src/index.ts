/**
 * Cloudflare Worker for Toggly Docusaurus Edge SDK
 *
 * This worker enforces feature flag gating at the edge, ensuring that
 * documentation for disabled features is not accessible.
 *
 * Features:
 * - Page-level gating: Returns 404 or redirects when page feature is disabled
 * - Section-level gating: Removes elements with data-feature attributes
 * - Edge-side caching for flags and manifest
 */

import type { Env, RequestContext, WorkerConfig } from './types';
import { PageGateBehavior } from './types';
import { getFeatureKeyForPath } from './manifest';
import { getFlags, isFeatureEnabled } from './flags';
import { transformHtmlResponse } from './html-rewriter';

// Worker configuration
const WORKER_CONFIG: WorkerConfig = {
  pageGateBehavior: PageGateBehavior.RETURN_404,
  redirectUrl: '/upgrade', // Only used if pageGateBehavior is REDIRECT
  flagsCacheTTL: 30, // 30 seconds
  manifestCacheTTL: 300, // 5 minutes
};

/**
 * Extract request context from request (cookies, headers, etc.)
 * Currently returns empty object, but can be extended to extract
 * user/tenant IDs from cookies or headers
 */
function getRequestContext(request: Request): RequestContext {
  // TODO: Extract user/tenant information from cookies or headers
  // Example:
  // const cookieHeader = request.headers.get('Cookie');
  // const userId = extractUserIdFromCookie(cookieHeader);
  // return { userId, tenantId: extractTenantId(request) };
  
  return {};
}

/**
 * Check if response is HTML
 */
function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/html');
}

/**
 * Handle page-level gating
 * Returns a response (404 or redirect) if the page feature is disabled
 */
async function handlePageLevelGate(
  path: string,
  featureKey: string,
  env: Env,
  context: RequestContext,
  cache: Cache | null,
  config: WorkerConfig
): Promise<Response | null> {
  const isEnabled = await isFeatureEnabled(featureKey, env, context, cache);

  if (!isEnabled) {
    if (config.pageGateBehavior === PageGateBehavior.REDIRECT) {
      const redirectUrl = config.redirectUrl || '/upgrade';
      return Response.redirect(new URL(redirectUrl, env.ORIGIN_BASE_URL).toString(), 302);
    } else {
      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }
  }

  return null; // Feature is enabled, continue processing
}

/**
 * Cloudflare Worker entry point
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Skip processing for manifest and other static assets
    if (path === '/toggly-page-features.json' || path.startsWith('/_next/') || path.startsWith('/static/')) {
      // Proxy to origin without modification
      const originUrl = new URL(path, env.ORIGIN_BASE_URL);
      return fetch(originUrl.toString(), request);
    }

    // Get request context (for future user/tenant targeting)
    const context = getRequestContext(request);

    // Get cache
    const cache = caches.default;

    // Check for page-level feature gate
    const featureKey = await getFeatureKeyForPath(path, env, cache);

    if (featureKey) {
      const gateResponse = await handlePageLevelGate(
        path,
        featureKey,
        env,
        context,
        cache,
        WORKER_CONFIG
      );

      if (gateResponse) {
        return gateResponse;
      }
    }

    // Fetch from origin
    const originUrl = new URL(path, env.ORIGIN_BASE_URL);
    const originRequest = new Request(originUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const response = await fetch(originRequest);

    // If not HTML, return as-is
    if (!isHtmlResponse(response)) {
      return response;
    }

    // For HTML responses, apply section-level gating
    const flags = await getFlags(env, context, cache);
    const transformedResponse = transformHtmlResponse(response, flags);

    return transformedResponse;
  },
};
