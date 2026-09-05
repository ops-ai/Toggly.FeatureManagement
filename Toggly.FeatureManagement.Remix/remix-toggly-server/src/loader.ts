/**
 * Remix loader utilities for Toggly
 */

import type { LoaderFunctionArgs } from '@remix-run/server-runtime';
import {
  TogglyConfig,
  FeatureFlags,
  ServerFeatureContext,
  IdentityContext,
  TOGGLY_LOADER_KEY,
} from '@ops-ai/remix-toggly-core';
import { TogglyServerClient, createServerClient } from './client';
import {
  extractEvalContext,
  type EvalContextProviders,
} from './extract-context';
import {
  getAmbientEvalOverrides,
  mergeIdentityContext,
  runWithEvalContext,
} from './eval-context-store';

/**
 * Options for creating a Toggly loader
 */
export interface TogglyLoaderOptions
  extends TogglyConfig, EvalContextProviders {}

function resolveIdentityOverride(
  override?: string | IdentityContext,
): IdentityContext | undefined {
  if (override == null) {
    return getAmbientEvalOverrides();
  }
  if (typeof override === 'string') {
    return mergeIdentityContext(getAmbientEvalOverrides(), {
      identity: override,
    });
  }
  return mergeIdentityContext(getAmbientEvalOverrides(), override);
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
     * Load feature flags for a loader function.
     * Builds ambient EvalContext (identity / groups / claims / request) for
     * the snapshot. Prefer `run` when calling `client.isEnabled('X')` without
     * an IdentityContext for the full loader duration.
     */
    async load(args: LoaderFunctionArgs): Promise<ServerFeatureContext> {
      const ambient = await extractEvalContext(args.request, options);
      await client.init(ambient.identity);

      return {
        flags: client.snapshotFlags(ambient),
        identity: ambient.identity,
        appKey: options.appKey,
        environment: options.environment,
        fetchedAt: Date.now(),
      };
    },

    /**
     * Bind ambient EvalContext for the full loader duration, then run `fn`.
     * Prefer this when calling `client.isEnabled('X')` without an IdentityContext.
     */
    async run<T>(
      args: LoaderFunctionArgs,
      fn: (
        ctx: ServerFeatureContext & { client: TogglyServerClient },
      ) => T | Promise<T>,
    ): Promise<T> {
      const ambient = await extractEvalContext(args.request, options);

      return runWithEvalContext(ambient, async () => {
        await client.init(ambient.identity);
        const ctx: ServerFeatureContext & { client: TogglyServerClient } = {
          flags: client.snapshotFlags(ambient),
          identity: ambient.identity,
          appKey: options.appKey,
          environment: options.environment,
          fetchedAt: Date.now(),
          client,
        };
        return fn(ctx);
      });
    },

    /**
     * Create loader data with feature context
     */
    async getLoaderData<T extends Record<string, unknown>>(
      args: LoaderFunctionArgs,
      additionalData?: T,
    ): Promise<T & { [TOGGLY_LOADER_KEY]: ServerFeatureContext }> {
      const context = await this.load(args);

      return {
        ...additionalData,
        [TOGGLY_LOADER_KEY]: context,
      } as T & { [TOGGLY_LOADER_KEY]: ServerFeatureContext };
    },

    /**
     * Check if a feature is enabled.
     * Ambient EvalContext (from `run` / `load` ALS scope) is merged;
     * per-call string identity or IdentityContext overrides field-by-field.
     */
    async isEnabled(
      featureKey: string,
      defaultValue = false,
      identityOrContext?: string | IdentityContext,
    ): Promise<boolean> {
      return client.isEnabled(
        featureKey,
        resolveIdentityOverride(identityOrContext),
        defaultValue,
      );
    },

    /**
     * Check if a feature is disabled
     */
    async isDisabled(
      featureKey: string,
      defaultValue = true,
      identityOrContext?: string | IdentityContext,
    ): Promise<boolean> {
      return client.isDisabled(
        featureKey,
        resolveIdentityOverride(identityOrContext),
        defaultValue,
      );
    },

    /**
     * Evaluate a feature gate
     */
    async evaluateGate(
      featureKeys: string[],
      requirement: 'all' | 'any' = 'all',
      negate = false,
      identityOrContext?: string | IdentityContext,
    ): Promise<boolean> {
      return client.evaluateGate(
        featureKeys,
        requirement,
        negate,
        false,
        undefined,
        undefined,
        resolveIdentityOverride(identityOrContext),
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
 * Standalone function to get feature flags in a loader
 */
export async function getFeatureFlags(
  request: Request,
  options: TogglyLoaderOptions,
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
  defaultValue = false,
): Promise<boolean> {
  const loader = createTogglyLoader(options);
  return loader.run({ request, params: {}, context: {} }, async ({ client }) =>
    client.isEnabled(featureKey, undefined, defaultValue),
  );
}

/**
 * Type helper for loader data with Toggly context
 */
export type WithTogglyContext<T> = T & {
  [TOGGLY_LOADER_KEY]: ServerFeatureContext;
};
