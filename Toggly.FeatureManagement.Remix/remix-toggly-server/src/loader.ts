/**
 * Remix loader utilities for Toggly
 */

import type { LoaderFunctionArgs } from '@remix-run/server-runtime';
import {
  TogglyConfig,
  FeatureFlags,
  ServerFeatureContext,
  TOGGLY_LOADER_KEY,
  parseIdentity,
  HEADERS,
  STORAGE_KEYS,
} from '@ops-ai/remix-toggly-core';
import { TogglyServerClient, createServerClient } from './client';

/**
 * Options for creating a Toggly loader
 */
export interface TogglyLoaderOptions extends TogglyConfig {
  /** Function to extract identity from request */
  getIdentity?: (request: Request) => string | undefined | Promise<string | undefined>;
  /** Function to extract identity from cookies */
  getIdentityFromCookies?: (cookies: string | null) => string | undefined;
}

/**
 * Create a loader helper for fetching feature flags
 */
export function createTogglyLoader(options: TogglyLoaderOptions) {
  const client = createServerClient(options);

  return {
    /**
     * Get the Toggly client
     */
    getClient(): TogglyServerClient {
      return client;
    },

    /**
     * Load feature flags for a loader function
     */
    async load(args: LoaderFunctionArgs): Promise<ServerFeatureContext> {
      const { request } = args;

      // Extract identity
      let identity: string | undefined;

      if (options.getIdentity) {
        identity = await options.getIdentity(request);
      } else {
        // Try to get from headers or cookies
        identity = getIdentityFromRequest(request, options.getIdentityFromCookies);
      }

      // Ensure definitions are loaded; request-local snapshot avoids shared flags race
      await client.init(identity);
      const identityCtx = { identity };

      return {
        flags: client.snapshotFlags(identityCtx),
        identity,
        appKey: options.appKey,
        environment: options.environment,
        fetchedAt: Date.now(),
      };
    },

    /**
     * Create loader data with feature context
     */
    async getLoaderData<T extends Record<string, unknown>>(
      args: LoaderFunctionArgs,
      additionalData?: T
    ): Promise<T & { [TOGGLY_LOADER_KEY]: ServerFeatureContext }> {
      const context = await this.load(args);

      return {
        ...additionalData,
        [TOGGLY_LOADER_KEY]: context,
      } as T & { [TOGGLY_LOADER_KEY]: ServerFeatureContext };
    },

    /**
     * Check if a feature is enabled for a request identity.
     * Prefer passing `identity` (from `load()` / headers) so concurrent
     * requests do not share process-wide client.identity.
     */
    async isEnabled(
      featureKey: string,
      defaultValue = false,
      identity?: string
    ): Promise<boolean> {
      return client.isEnabled(featureKey, { identity }, defaultValue);
    },

    /**
     * Check if a feature is disabled
     */
    async isDisabled(
      featureKey: string,
      defaultValue = true,
      identity?: string
    ): Promise<boolean> {
      return client.isDisabled(featureKey, { identity }, defaultValue);
    },

    /**
     * Evaluate a feature gate
     */
    async evaluateGate(
      featureKeys: string[],
      requirement: 'all' | 'any' = 'all',
      negate = false,
      identity?: string
    ): Promise<boolean> {
      return client.evaluateGate(
        featureKeys,
        requirement,
        negate,
        false,
        undefined,
        undefined,
        { identity },
      );
    },

    /**
     * Get all flags
     */
    getFlags(): FeatureFlags {
      return client.getFlags();
    },
  };
}

/**
 * Extract identity from request headers or cookies
 */
function getIdentityFromRequest(
  request: Request,
  customCookieParser?: (cookies: string | null) => string | undefined
): string | undefined {
  // Try header first
  const headerIdentity = request.headers.get(HEADERS.IDENTITY);
  if (headerIdentity) {
    return parseIdentity(headerIdentity);
  }

  // Try cookies
  const cookies = request.headers.get('cookie');

  if (customCookieParser) {
    return customCookieParser(cookies);
  }

  if (cookies) {
    // Parse cookie manually (simple implementation)
    const identity = parseCookie(cookies, STORAGE_KEYS.IDENTITY);
    if (identity) {
      return parseIdentity(identity);
    }
  }

  return undefined;
}

/**
 * Simple cookie parser
 */
function parseCookie(cookies: string, name: string): string | undefined {
  const pairs = cookies.split(';');

  for (const pair of pairs) {
    const [key, value] = pair.trim().split('=');
    if (key === name && value) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Standalone function to get feature flags in a loader
 */
export async function getFeatureFlags(
  request: Request,
  options: TogglyLoaderOptions
): Promise<ServerFeatureContext> {
  const loader = createTogglyLoader(options);
  return loader.load({ request, params: {}, context: {} });
}

/**
 * Check if a single feature is enabled (standalone)
 */
export async function isFeatureEnabled(
  request: Request,
  featureKey: string,
  options: TogglyLoaderOptions,
  defaultValue = false
): Promise<boolean> {
  const loader = createTogglyLoader(options);
  const ctx = await loader.load({ request, params: {}, context: {} });
  return loader.isEnabled(featureKey, defaultValue, ctx.identity);
}

/**
 * Type helper for loader data with Toggly context
 */
export type WithTogglyContext<T> = T & {
  [TOGGLY_LOADER_KEY]: ServerFeatureContext;
};
