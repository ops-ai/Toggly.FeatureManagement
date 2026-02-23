import { TogglyConfig, TogglyHook, FeatureFlags, IdentityContext, TOGGLY_LOADER_KEY, ServerFeatureContext } from '@ops-ai/remix-toggly-core';
export { EvaluationResult, EvaluationSeriesData, FeatureFlags, FeatureRequirement, HEADERS, HookMetadata, IdentityContext, IdentitySeriesData, STORAGE_KEYS, ServerFeatureContext, TOGGLY_LOADER_KEY, TogglyConfig, TogglyConfigError, TogglyError, TogglyHook, TogglyNetworkError, TogglyTimeoutError } from '@ops-ai/remix-toggly-core';
import { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/server-runtime';

/**
 * Server-side Toggly client
 */

/**
 * Server-side Toggly client for fetching and evaluating feature flags
 */
declare class TogglyServerClient {
    private readonly config;
    private readonly logger;
    private flags;
    private hooks;
    private initialized;
    constructor(config: TogglyConfig);
    /**
     * Add a hook to the client
     */
    addHook(hook: TogglyHook): void;
    /**
     * Remove a hook by name
     */
    removeHook(name: string): boolean;
    /**
     * Initialize the client by fetching feature flags
     */
    init(identity?: string): Promise<FeatureFlags>;
    /**
     * Fetch feature flags from the API
     */
    fetchFlags(identity?: string): Promise<FeatureFlags>;
    /**
     * Get all flags
     */
    getFlags(): FeatureFlags;
    /**
     * Check if a feature is enabled
     */
    isEnabled(featureKey: string, _context?: IdentityContext, defaultValue?: boolean): Promise<boolean>;
    /**
     * Check if a feature is disabled
     */
    isDisabled(featureKey: string, context?: IdentityContext, defaultValue?: boolean): Promise<boolean>;
    /**
     * Evaluate a feature gate (multiple features)
     */
    evaluateGate(featureKeys: string[], requirement?: 'all' | 'any', negate?: boolean, defaultValue?: boolean): Promise<boolean>;
    /**
     * Get the server context for client hydration
     */
    getServerContext(): {
        flags: FeatureFlags;
        appKey?: string;
        environment?: string;
        fetchedAt: number;
    };
    private executeBeforeEvaluation;
    private executeAfterEvaluation;
    private executeBeforeIdentify;
    private executeAfterIdentify;
    private executeAfterRefresh;
}
/**
 * Create a new server client instance
 */
declare function createServerClient(config: TogglyConfig): TogglyServerClient;

/**
 * Remix loader utilities for Toggly
 */

/**
 * Options for creating a Toggly loader
 */
interface TogglyLoaderOptions extends TogglyConfig {
    /** Function to extract identity from request */
    getIdentity?: (request: Request) => string | undefined | Promise<string | undefined>;
    /** Function to extract identity from cookies */
    getIdentityFromCookies?: (cookies: string | null) => string | undefined;
}
/**
 * Create a loader helper for fetching feature flags
 */
declare function createTogglyLoader(options: TogglyLoaderOptions): {
    /**
     * Get the Toggly client
     */
    getClient(): TogglyServerClient;
    /**
     * Load feature flags for a loader function
     */
    load(args: LoaderFunctionArgs): Promise<ServerFeatureContext>;
    /**
     * Create loader data with feature context
     */
    getLoaderData<T extends Record<string, unknown>>(args: LoaderFunctionArgs, additionalData?: T): Promise<T & {
        [TOGGLY_LOADER_KEY]: ServerFeatureContext;
    }>;
    /**
     * Check if a feature is enabled
     */
    isEnabled(featureKey: string, defaultValue?: boolean): Promise<boolean>;
    /**
     * Check if a feature is disabled
     */
    isDisabled(featureKey: string, defaultValue?: boolean): Promise<boolean>;
    /**
     * Evaluate a feature gate
     */
    evaluateGate(featureKeys: string[], requirement?: "all" | "any", negate?: boolean): Promise<boolean>;
    /**
     * Get all flags
     */
    getFlags(): FeatureFlags;
};
/**
 * Standalone function to get feature flags in a loader
 */
declare function getFeatureFlags(request: Request, options: TogglyLoaderOptions): Promise<ServerFeatureContext>;
/**
 * Check if a single feature is enabled (standalone)
 */
declare function isFeatureEnabled(request: Request, featureKey: string, options: TogglyLoaderOptions, defaultValue?: boolean): Promise<boolean>;
/**
 * Type helper for loader data with Toggly context
 */
type WithTogglyContext<T> = T & {
    [TOGGLY_LOADER_KEY]: ServerFeatureContext;
};

/**
 * Remix action utilities for Toggly
 */

/**
 * Options for feature-gated actions
 */
interface FeatureGatedActionOptions extends TogglyLoaderOptions {
    /** Feature key(s) required for this action */
    requiredFeatures?: string | string[];
    /** Feature requirement type */
    requirement?: 'all' | 'any';
    /** Response when feature is disabled */
    onFeatureDisabled?: (request: Request, featureKeys: string[]) => Response | Promise<Response>;
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
interface TogglyActionContext {
    /** Toggly server client */
    client: TogglyServerClient;
    /** Feature flags */
    flags: FeatureFlags;
    /** Check if feature is enabled */
    isEnabled: (featureKey: string, defaultValue?: boolean) => Promise<boolean>;
    /** Check if feature is disabled */
    isDisabled: (featureKey: string, defaultValue?: boolean) => Promise<boolean>;
    /** Evaluate feature gate */
    evaluateGate: (featureKeys: string[], requirement?: 'all' | 'any', negate?: boolean) => Promise<boolean>;
}
/**
 * Create a feature-gated action handler
 */
declare function createFeatureGatedAction<T>(options: FeatureGatedActionOptions, handler: (args: ActionFunctionArgs, toggly: TogglyActionContext) => Promise<T> | T): (args: ActionFunctionArgs) => Promise<T | Response>;
/**
 * Create a Toggly-aware action helper
 */
declare function createTogglyAction(options: TogglyLoaderOptions): {
    /**
     * Get the Toggly client
     */
    getClient(): TogglyServerClient;
    /**
     * Initialize for an action request
     */
    init(request: Request): Promise<TogglyActionContext>;
    /**
     * Wrap an action with feature checks
     */
    requireFeature<T>(featureKey: string, handler: (args: ActionFunctionArgs, toggly: TogglyActionContext) => Promise<T> | T, onDisabled?: () => Response | Promise<Response>): (args: ActionFunctionArgs) => Promise<Response | T>;
    /**
     * Wrap an action with feature gate checks
     */
    requireFeatures<T>(featureKeys: string[], requirement: "all" | "any", handler: (args: ActionFunctionArgs, toggly: TogglyActionContext) => Promise<T> | T, onDisabled?: () => Response | Promise<Response>): (args: ActionFunctionArgs) => Promise<Response | T>;
};
/**
 * Higher-order function to require a feature for an action
 */
declare function requireFeature(featureKey: string, options: TogglyLoaderOptions, onDisabled?: () => Response | Promise<Response>): <T>(handler: (args: ActionFunctionArgs, toggly: TogglyActionContext) => Promise<T> | T) => (args: ActionFunctionArgs) => Promise<Response | T>;

export { type FeatureGatedActionOptions, type TogglyActionContext, type TogglyLoaderOptions, TogglyServerClient, type WithTogglyContext, createFeatureGatedAction, createServerClient, createTogglyAction, createTogglyLoader, getFeatureFlags, isFeatureEnabled, requireFeature };
