/**
 * Remix action utilities for Toggly
 */

import type { ActionFunctionArgs } from '@remix-run/server-runtime';
import { json, redirect } from '@remix-run/server-runtime';
import type { FeatureFlags, IdentityContext } from '@ops-ai/remix-toggly-core';
import { TogglyServerClient, createServerClient } from './client';
import type { TogglyLoaderOptions } from './loader';
import { extractEvalContext } from './extract-context';
import { runWithEvalContext } from './eval-context-store';

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
    featureKeys: string[],
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
  /** Ambient EvalContext bound for this action */
  context: IdentityContext;
  /** Check if feature is enabled (uses ambient; optional override) */
  isEnabled: (
    featureKey: string,
    defaultValue?: boolean,
    override?: IdentityContext,
  ) => Promise<boolean>;
  /** Check if feature is disabled */
  isDisabled: (
    featureKey: string,
    defaultValue?: boolean,
    override?: IdentityContext,
  ) => Promise<boolean>;
  /** Evaluate feature gate */
  evaluateGate: (
    featureKeys: string[],
    requirement?: 'all' | 'any',
    negate?: boolean,
    override?: IdentityContext,
  ) => Promise<boolean>;
}

function buildActionContext(
  client: TogglyServerClient,
  ambient: IdentityContext,
): TogglyActionContext {
  return {
    client,
    flags: client.snapshotFlags(ambient),
    context: ambient,
    isEnabled: (key, def, override) =>
      client.isEnabled(key, override ?? ambient, def),
    isDisabled: (key, def, override) =>
      client.isDisabled(key, override ?? ambient, def),
    evaluateGate: (keys, req, neg, override) =>
      client.evaluateGate(
        keys,
        req,
        neg,
        false,
        undefined,
        undefined,
        override ?? ambient,
      ),
  };
}

/**
 * Create a feature-gated action handler
 */
export function createFeatureGatedAction<T>(
  options: FeatureGatedActionOptions,
  handler: (
    args: ActionFunctionArgs,
    toggly: TogglyActionContext,
  ) => Promise<T> | T,
) {
  return async (args: ActionFunctionArgs): Promise<T | Response> => {
    const { request } = args;
    const client = createServerClient(options);
    const ambient = await extractEvalContext(request, options);

    return runWithEvalContext(ambient, async () => {
      await client.init(ambient.identity);
      const togglyContext = buildActionContext(client, ambient);

      if (options.requiredFeatures) {
        const featureKeys = Array.isArray(options.requiredFeatures)
          ? options.requiredFeatures
          : [options.requiredFeatures];

        const requirement = options.requirement ?? 'all';
        const isAllowed = await client.evaluateGate(
          featureKeys,
          requirement,
          false,
          false,
          undefined,
          undefined,
          ambient,
        );

        if (!isAllowed) {
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
            { status: options.errorStatus ?? 403 },
          ) as Response;
        }
      }

      return handler(args, togglyContext);
    });
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
     * Initialize for an action request.
     * Returned helpers close over ambient EvalContext so `toggly.isEnabled('X')`
     * needs no IdentityContext. Prefer `run` when using `client.isEnabled('X')`
     * directly for the full action duration.
     */
    async init(request: Request): Promise<TogglyActionContext> {
      const ambient = await extractEvalContext(request, options);
      await client.init(ambient.identity);
      return buildActionContext(client, ambient);
    },

    /**
     * Bind ambient EvalContext and run an action handler.
     */
    async run<T>(
      args: ActionFunctionArgs,
      fn: (
        args: ActionFunctionArgs,
        toggly: TogglyActionContext,
      ) => T | Promise<T>,
    ): Promise<T> {
      const ambient = await extractEvalContext(args.request, options);
      return runWithEvalContext(ambient, async () => {
        await client.init(ambient.identity);
        return fn(args, buildActionContext(client, ambient));
      });
    },

    /**
     * Wrap an action with feature checks
     */
    requireFeature<T>(
      featureKey: string,
      handler: (
        args: ActionFunctionArgs,
        toggly: TogglyActionContext,
      ) => Promise<T> | T,
      onDisabled?: () => Response | Promise<Response>,
    ) {
      return createFeatureGatedAction(
        {
          ...options,
          requiredFeatures: featureKey,
          onFeatureDisabled: onDisabled,
        },
        handler,
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
        toggly: TogglyActionContext,
      ) => Promise<T> | T,
      onDisabled?: () => Response | Promise<Response>,
    ) {
      return createFeatureGatedAction(
        {
          ...options,
          requiredFeatures: featureKeys,
          requirement,
          onFeatureDisabled: onDisabled,
        },
        handler,
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
  onDisabled?: () => Response | Promise<Response>,
) {
  return function <T>(
    handler: (
      args: ActionFunctionArgs,
      toggly: TogglyActionContext,
    ) => Promise<T> | T,
  ) {
    return createFeatureGatedAction(
      {
        ...options,
        requiredFeatures: featureKey,
        onFeatureDisabled: onDisabled
          ? () => onDisabled()
          : undefined,
      },
      handler,
    );
  };
}
