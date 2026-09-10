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
 * - Batched usage + business metrics via HTTPS JSON (gateway path)
 */

import type { Env, RequestContext, WorkerConfig } from './types';
import { PageGateBehavior } from './types';
import { getFeatureKeyForPath } from './manifest';
import { getFlags, isFeatureEnabled } from './flags';
import { transformHtmlResponse } from './html-rewriter';
import { fetchFromOrigin, probeOriginAccess } from './origin';
import { RequestScopedUsageRecorder } from './request-usage';
import { wrapReadableWithCompletion } from './stream-flush';
import {
  getOrCreateTelemetry,
  parseBoolEnv,
  resolveMetricsBaseUrl,
  type TelemetryRuntime,
} from './telemetry';

// ---------------------------------------------------------------------------
// Public package API (business metrics + usage helpers for Worker extensions)
// ---------------------------------------------------------------------------

export {
  getOrCreateTelemetry,
  resetTelemetrySingleton,
  TelemetryRuntime,
  parseBoolEnv,
  resolveMetricsBaseUrl,
  hashIdentity,
  WORKER_VERSION,
  WORKER_USER_AGENT,
  DEFAULT_METRICS_BASE_URL,
  type TelemetryConfig,
  type MetricsFeatureOptions,
  type FeatureStatHttpPayload,
  type MetricStatHttpPayload,
} from './telemetry';

export { RequestScopedUsageRecorder } from './request-usage';
export { wrapReadableWithCompletion } from './stream-flush';
export type { Env, RequestContext, WorkerConfig } from './types';
export { PageGateBehavior } from './types';

// Worker configuration
const WORKER_CONFIG: WorkerConfig = {
  pageGateBehavior: PageGateBehavior.RETURN_404,
  redirectUrl: '/upgrade', // Only used if pageGateBehavior is REDIRECT
  flagsCacheTTL: 30, // 30 seconds
  manifestCacheTTL: 300, // 5 minutes
};

/**
 * Build isolate-scoped telemetry from Worker env (usage + business metrics).
 * Prefer this from custom Worker extensions that need measure/counter/observe.
 */
export function createTelemetryFromEnv(env: Env): TelemetryRuntime | null {
  const hasAppKey = Boolean(env.TOGGLY_APP_KEY);
  return getOrCreateTelemetry({
    appKey: env.TOGGLY_APP_KEY,
    environment: env.TOGGLY_ENVIRONMENT,
    metricsBaseUrl: resolveMetricsBaseUrl(env.TOGGLY_METRICS_BASE_URL),
    enableUsageTracking: parseBoolEnv(env.TOGGLY_USAGE_ENABLED, hasAppKey),
    enableMetrics: parseBoolEnv(env.TOGGLY_METRICS_ENABLED, hasAppKey),
  });
}

function identityFromContext(context: RequestContext): string | undefined {
  if (typeof context.userId === 'string' && context.userId.length > 0) {
    return context.userId;
  }
  return undefined;
}

/**
 * Extract request context from request (cookies, headers, etc.)
 * Currently returns empty object, but can be extended to extract
 * user/tenant IDs from cookies or headers
 */
function getRequestContext(_request: Request): RequestContext {
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
  featureKey: string,
  env: Env,
  context: RequestContext,
  cache: Cache | null,
  config: WorkerConfig,
  publicOrigin: string,
  usage: RequestScopedUsageRecorder,
  telemetry: TelemetryRuntime | null,
): Promise<Response | null> {
  const recorder = telemetry?.isUsageEnabled() ? telemetry : null;
  const isEnabled = await isFeatureEnabled(
    featureKey,
    env,
    context,
    cache,
    recorder,
  );

  usage.recordGate(featureKey, isEnabled, identityFromContext(context));

  if (!isEnabled) {
    if (config.pageGateBehavior === PageGateBehavior.REDIRECT) {
      const redirectUrl = config.redirectUrl || '/upgrade';
      return Response.redirect(new URL(redirectUrl, publicOrigin).toString(), 302);
    }
    return new Response('Not Found', {
      status: 404,
      statusText: 'Not Found',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  return null; // Feature is enabled, continue processing
}

function buildOriginRequestInit(request: Request): RequestInit {
  const headers = new Headers();
  const allow = [
    'accept',
    'accept-encoding',
    'accept-language',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'range',
  ];

  for (const name of allow) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  return init;
}

function assertOriginConfigured(env: Env): void {
  if (!env.ORIGIN_BASE_URL) {
    throw new Error('ORIGIN_BASE_URL is not configured on the Worker');
  }
}

function flushTelemetry(
  telemetry: TelemetryRuntime | null,
  ctx: ExecutionContext,
): void {
  if (!telemetry) return;
  try {
    telemetry.scheduleFlush((promise) => ctx.waitUntil(promise));
  } catch {
    // never break the response path
  }
}

/**
 * Return HTML with telemetry flushed after the **client-consumed** stream
 * completes. Pull-driven wrapper preserves backpressure (no tee + eager drain).
 */
function respondHtmlWithDeferredFlush(
  response: Response,
  telemetry: TelemetryRuntime | null,
  ctx: ExecutionContext,
): Response {
  const body = response.body;
  if (!body || !telemetry) {
    flushTelemetry(telemetry, ctx);
    return response;
  }

  const wrapped = wrapReadableWithCompletion(
    body,
    () => telemetry.flush(),
    (promise) => ctx.waitUntil(promise),
  );

  return new Response(wrapped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Cloudflare Worker entry point
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const telemetry = createTelemetryFromEnv(env);
    const usage = new RequestScopedUsageRecorder(telemetry);

    try {
      assertOriginConfigured(env);

      const url = new URL(request.url);
      const path = url.pathname;
      const publicOrigin = url.origin;
      const originRequestInit = buildOriginRequestInit(request);

      if (path === '/__toggly_origin_probe') {
        return probeOriginAccess(env);
      }

      // Skip processing for the manifest and common static-asset paths so we
      // don't pay manifest lookup + HTMLRewriter cost on every JS/CSS/img hit.
      // Non-HTML responses are also passed through unchanged below (see
      // `isHtmlResponse`), so this prefix list is just an optimisation.
      if (
        path === '/toggly-page-features.json' ||
        path.startsWith('/assets/') ||
        path.startsWith('/img/') ||
        path.startsWith('/static/') ||
        path.startsWith('/_next/')
      ) {
        const originUrl = new URL(path + url.search, env.ORIGIN_BASE_URL);
        return fetchFromOrigin(originUrl.toString(), originRequestInit, env);
      }

      // Get request context (for future user/tenant targeting)
      const context = getRequestContext(request);

      // Get cache
      const cache = caches.default;

      // Check for page-level feature gate
      const featureKey = await getFeatureKeyForPath(path, env, cache);

      if (featureKey) {
        const gateResponse = await handlePageLevelGate(
          featureKey,
          env,
          context,
          cache,
          WORKER_CONFIG,
          publicOrigin,
          usage,
          telemetry,
        );

        if (gateResponse) {
          flushTelemetry(telemetry, ctx);
          return gateResponse;
        }
      }

      // Fetch from origin (Access-token aware). We rebuild the URL onto the
      // configured origin so the worker can sit on a different hostname than
      // the origin without looping through itself.
      const originUrl = new URL(path + url.search, env.ORIGIN_BASE_URL);
      const response = await fetchFromOrigin(
        originUrl.toString(),
        originRequestInit,
        env,
      );

      // If not HTML, return as-is
      if (!isHtmlResponse(response)) {
        flushTelemetry(telemetry, ctx);
        return response;
      }

      // For HTML responses, apply section-level gating
      const recorder = telemetry?.isUsageEnabled() ? telemetry : null;
      const flags = await getFlags(env, context, cache, recorder);
      const identity = identityFromContext(context);
      const transformed = transformHtmlResponse(
        response,
        flags,
        (sectionFeature, enabled) => {
          usage.recordGate(sectionFeature, enabled, identity);
        },
      );

      return respondHtmlWithDeferredFlush(transformed, telemetry, ctx);
    } catch (error) {
      flushTelemetry(telemetry, ctx);
      console.error('Worker request failed', error);
      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
