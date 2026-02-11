/**
 * Remix action utilities for Toggly
 */

import type { ActionFunctionArgs } from '@remix-run/server-runtime';
import { json, redirect } from '@remix-run/server-runtime';
import {
  TogglyConfig,
  FeatureFlags,
} from '@ops-ai/remix-toggly-core';
import { TogglyServerClient, createServerClient } from './client';
import { TogglyLoaderOptions } from './loader';

/**
 * Options for feature-gated actions
 */
export interface FeatureGatedActionOptions extends TogglyLoaderOptions {
  /** Feature key(s) required for this action */
  requiredFeatures?: string | string[];
  /** Feature requirement type */
  requirement?: 'all' | 'any';
  /** Response when feature is disabled */
  onFeatureDisabled?: (
    request: Request,
    featureKeys: string[]
  ) => Response | Promise<Response>;
  /** Redirect URL when feature is disabled */
  redirectTo?: string;
  /** Status code for JSON error response */
  errorStatus?: number;
  /** Error message for JSON error response */
  errorMessage?: string;
}

/**
 * Action context with Toggly client
 */
export interface TogglyActionContext {
  /** Toggly server client */
  client: TogglyServerClient;
  /** Feature flags */
  flags: FeatureFlags;
  /** Check if feature is enabled */
  isEnabled: (featureKey: string, defaultValue?: boolean) => Promise<boolean>;
  /** Check if feature is disabled */
  isDisabled: (featureKey: string, defaultValue?: boolean) => Promise<boolean>;
  /** Evaluate feature gate */
  evaluateGate: (
    featureKeys: string[],
    requirement?: 'all' | 'any',
    negate?: boolean
  ) => Promise<boolean>;
}

/**
 * Create a feature-gated action handler
 */
export function createFeatureGatedAction<T>(
  options: FeatureGatedActionOptions,
  handler: (
    args: ActionFunctionArgs,
    toggly: TogglyActionContext
  ) => Promise<T> | T
) {
  return async (args: ActionFunctionArgs): Promise<T | Response> => {
    const { request } = args;
    const client = createServerClient(options);

    // Extract identity and initialize
    let identity: string | undefined;
    if (options.getIdentity) {
      identity = await options.getIdentity(request);
    }
    await client.init(identity);

    // Create context
    const togglyContext: TogglyActionContext = {
      client,
      flags: client.getFlags(),
      isEnabled: (key, def) => client.isEnabled(key, undefined, def),
      isDisabled: (key, def) => client.isDisabled(key, undefined, def),
      evaluateGate: (keys, req, neg) => client.evaluateGate(keys, req, neg),
    };

    // Check required features
    if (options.requiredFeatures) {
      const featureKeys = Array.isArray(options.requiredFeatures)
        ? options.requiredFeatures
        : [options.requiredFeatures];

      const requirement = options.requirement ?? 'all';
      const isAllowed = await client.evaluateGate(featureKeys, requirement);

      if (!isAllowed) {
        // Handle disabled feature
        if (options.onFeatureDisabled) {
          return options.onFeatureDisabled(request, featureKeys);
        }

        if (options.redirectTo) {
          return redirect(options.redirectTo);
        }

        return json(
          {
            error: options.errorMessage ?? 'Feature is not available',
            featureKeys,
          },
          { status: options.errorStatus ?? 403 }
        ) as Response;
      }
    }

    // Execute handler
    return handler(args, togglyContext);
  };
}

/**
 * Create a Toggly-aware action helper
 */
export function createTogglyAction(options: TogglyLoaderOptions) {
  const client = createServerClient(options);

  return {
    /**
     * Get the Toggly client
     */
    getClient(): TogglyServerClient {
      return client;
    },

    /**
     * Initialize for an action request
     */
    async init(request: Request): Promise<TogglyActionContext> {
      let identity: string | undefined;

      if (options.getIdentity) {
        identity = await options.getIdentity(request);
      }

      await client.init(identity);

      return {
        client,
        flags: client.getFlags(),
        isEnabled: (key, def) => client.isEnabled(key, undefined, def),
        isDisabled: (key, def) => client.isDisabled(key, undefined, def),
        evaluateGate: (keys, req, neg) => client.evaluateGate(keys, req, neg),
      };
    },

    /**
     * Wrap an action with feature checks
     */
    requireFeature<T>(
      featureKey: string,
      handler: (
        args: ActionFunctionArgs,
        toggly: TogglyActionContext
      ) => Promise<T> | T,
      onDisabled?: () => Response | Promise<Response>
    ) {
      return createFeatureGatedAction(
        {
          ...options,
          requiredFeatures: featureKey,
          onFeatureDisabled: onDisabled,
        },
        handler
      );
    },

    /**
     * Wrap an action with feature gate checks
     */
    requireFeatures<T>(
      featureKeys: string[],
      requirement: 'all' | 'any',
      handler: (
        args: ActionFunctionArgs,
        toggly: TogglyActionContext
      ) => Promise<T> | T,
      onDisabled?: () => Response | Promise<Response>
    ) {
      return createFeatureGatedAction(
        {
          ...options,
          requiredFeatures: featureKeys,
          requirement,
          onFeatureDisabled: onDisabled,
        },
        handler
      );
    },
  };
}

/**
 * Higher-order function to require a feature for an action
 */
export function requireFeature(
  featureKey: string,
  options: TogglyLoaderOptions,
  onDisabled?: () => Response | Promise<Response>
) {
  return function <T>(
    handler: (
      args: ActionFunctionArgs,
      toggly: TogglyActionContext
    ) => Promise<T> | T
  ) {
    return createFeatureGatedAction(
      {
        ...options,
        requiredFeatures: featureKey,
        onFeatureDisabled: onDisabled
          ? () => onDisabled()
          : undefined,
      },
      handler
    );
  };
}
