/**
 * Type definitions for the Cloudflare Worker
 */

export interface Env {
  /** Toggly API base URL */
  TOGGLY_API_BASE_URL: string;
  /** Toggly environment name (e.g., 'Production', 'Staging') */
  TOGGLY_ENVIRONMENT: string;
  /** Toggly application key */
  TOGGLY_APP_KEY: string;
  /** Origin base URL (e.g., Cloudflare Pages URL or GitHub Pages URL) */
  ORIGIN_BASE_URL: string;
  /**
   * Cloudflare Access service-token client ID. Only required when
   * `ORIGIN_BASE_URL` is gated by Cloudflare Access. When both this and
   * `CF_ACCESS_CLIENT_SECRET` are set, the worker injects the appropriate
   * headers on every origin fetch so the request bypasses the Access login.
   */
  CF_ACCESS_CLIENT_ID?: string;
  /** Cloudflare Access service-token client secret. See `CF_ACCESS_CLIENT_ID`. */
  CF_ACCESS_CLIENT_SECRET?: string;
}

/**
 * Page feature mapping from the manifest
 */
export interface PageFeatureMapping {
  [routePath: string]: string;
}

/**
 * Request context for feature flag evaluation
 * Can be extended with user/tenant information from cookies or headers
 */
export interface RequestContext {
  [key: string]: unknown;
}

/**
 * Configuration for page-level gating behavior
 */
export const PageGateBehavior = {
  /** Return 404 when feature is disabled */
  RETURN_404: '404',
  /** Redirect to a URL when feature is disabled */
  REDIRECT: 'redirect',
} as const;

export type PageGateBehavior = typeof PageGateBehavior[keyof typeof PageGateBehavior];

/**
 * Worker configuration
 */
export interface WorkerConfig {
  /** Behavior when a page-level feature is disabled */
  pageGateBehavior: PageGateBehavior;
  /** Redirect URL when pageGateBehavior is REDIRECT */
  redirectUrl?: string;
  /** Cache TTL for flags in seconds */
  flagsCacheTTL: number;
  /** Cache TTL for manifest in seconds */
  manifestCacheTTL: number;
}
