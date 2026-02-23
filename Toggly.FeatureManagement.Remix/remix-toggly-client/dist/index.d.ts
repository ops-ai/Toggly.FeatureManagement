import * as _ops_ai_remix_toggly_core from '@ops-ai/remix-toggly-core';
import { ServerFeatureContext, TogglyConfig, FeatureFlags, IdentityContext, TogglyHook, FeatureRequirement, TOGGLY_LOADER_KEY } from '@ops-ai/remix-toggly-core';
export { EvaluationResult, EvaluationSeriesData, FeatureFlags, FeatureRequirement, HEADERS, HookMetadata, IdentityContext, IdentitySeriesData, STORAGE_KEYS, ServerFeatureContext, TOGGLY_LOADER_KEY, TogglyConfig, TogglyConfigError, TogglyError, TogglyHook, TogglyNetworkError, TogglyTimeoutError } from '@ops-ai/remix-toggly-core';
import * as react from 'react';
import { ReactNode, ReactElement } from 'react';
import { SerializeFrom } from '@remix-run/react';

/**
 * Toggly context value
 */
interface TogglyContextValue {
    /** Current feature flags */
    flags: FeatureFlags;
    /** Whether the client is initialized */
    isReady: boolean;
    /** Current identity */
    identity?: string;
    /** Check if a feature is enabled */
    isEnabled: (featureKey: string, defaultValue?: boolean) => boolean;
    /** Check if a feature is disabled */
    isDisabled: (featureKey: string, defaultValue?: boolean) => boolean;
    /** Evaluate a feature gate */
    evaluateGate: (featureKeys: string[], requirement?: 'all' | 'any', negate?: boolean) => boolean;
    /** Set user identity */
    identify: (identity: string, context?: IdentityContext) => Promise<void>;
    /** Clear user identity */
    reset: () => Promise<void>;
    /** Refresh feature flags */
    refresh: () => Promise<void>;
    /** Add a hook */
    addHook: (hook: TogglyHook) => void;
    /** Remove a hook by name */
    removeHook: (name: string) => boolean;
}
/**
 * Toggly provider props
 */
interface TogglyProviderProps {
    /** Child components */
    children: ReactNode;
    /** Server-side feature context for hydration */
    serverContext?: ServerFeatureContext;
    /** Toggly configuration */
    config?: TogglyConfig;
    /** Enable client-side refresh */
    enableRefresh?: boolean;
    /** Refresh interval in milliseconds */
    refreshInterval?: number;
    /** Callback when flags are updated */
    onFlagsChange?: (flags: FeatureFlags) => void;
}
declare const TogglyContext: react.Context<TogglyContextValue | undefined>;
/**
 * Toggly Provider component
 */
declare function TogglyProvider({ children, serverContext, config, enableRefresh, refreshInterval, onFlagsChange, }: TogglyProviderProps): ReactElement;
/**
 * Hook to access Toggly context
 */
declare function useTogglyContext(): TogglyContextValue;

/**
 * Hook to access the Toggly context
 */
declare function useToggly(): TogglyContextValue;
/**
 * Hook to check if a feature is enabled
 */
declare function useFeature(featureKey: string, defaultValue?: boolean): boolean;
/**
 * Hook to check if a feature is disabled
 */
declare function useFeatureDisabled(featureKey: string, defaultValue?: boolean): boolean;
/**
 * Hook to evaluate a feature gate (multiple features)
 */
declare function useFeatureGate(featureKeys: string[], requirement?: FeatureRequirement, negate?: boolean): boolean;
/**
 * Hook to get all feature flags
 */
declare function useFeatureFlags(): FeatureFlags;
/**
 * Hook to check multiple features at once
 */
declare function useFeatures(featureKeys: string[], defaultValue?: boolean): Record<string, boolean>;
/**
 * Hook for feature flag with callback
 */
declare function useFeatureCallback<T>(featureKey: string, enabledCallback: () => T, disabledCallback: () => T, defaultValue?: boolean): T;
/**
 * Hook to get feature value with typing
 */
declare function useFeatureValue<T>(featureKey: string, enabledValue: T, disabledValue: T, defaultValue?: boolean): T;
/**
 * Hook to track feature flag changes
 */
declare function useFeatureChange(featureKey: string, _onChange: (enabled: boolean) => void): boolean;
/**
 * Hook for identity management
 */
declare function useIdentity(): {
    identity: string | undefined;
    identify: (identity: string, context?: _ops_ai_remix_toggly_core.IdentityContext) => Promise<void>;
    reset: () => Promise<void>;
};
/**
 * Hook to check if Toggly is ready
 */
declare function useTogglyReady(): boolean;
/**
 * Hook for refreshing flags
 */
declare function useRefreshFlags(): () => Promise<void>;
/**
 * Hook for conditional rendering based on feature
 */
declare function useFeatureRender<T>(featureKey: string, enabled: T, disabled: T, defaultValue?: boolean): T;
/**
 * Hook for A/B testing with feature flags
 */
declare function useABTest(featureKey: string, variantA: string, variantB: string, defaultVariant?: 'A' | 'B'): string;
/**
 * Hook to get a feature with loading state
 */
declare function useFeatureWithLoading(featureKey: string, defaultValue?: boolean): {
    enabled: boolean;
    isLoading: boolean;
};

/**
 * Feature component for declarative feature flag rendering
 */

/**
 * Props for Feature component
 */
interface FeatureProps {
    /** Feature key to check */
    featureKey?: string;
    /** Multiple feature keys to check */
    featureKeys?: string[];
    /** Requirement type when using multiple features */
    requirement?: FeatureRequirement;
    /** Negate the feature check */
    negate?: boolean;
    /** Default value if feature is not found */
    defaultValue?: boolean;
    /** Content to render when feature is enabled */
    children?: ReactNode;
    /** Content to render when feature is disabled */
    fallback?: ReactNode;
    /** Render prop for custom rendering */
    render?: (enabled: boolean) => ReactNode;
}
/**
 * Feature component for conditional rendering based on feature flags
 *
 * @example
 * // Simple usage
 * <Feature featureKey="new-dashboard">
 *   <NewDashboard />
 * </Feature>
 *
 * @example
 * // With fallback
 * <Feature featureKey="new-dashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </Feature>
 *
 * @example
 * // Multiple features (all required)
 * <Feature featureKeys={["premium", "analytics"]} requirement="all">
 *   <PremiumAnalytics />
 * </Feature>
 *
 * @example
 * // Negated (show when disabled)
 * <Feature featureKey="maintenance-mode" negate>
 *   <MainContent />
 * </Feature>
 *
 * @example
 * // Render prop
 * <Feature featureKey="dark-mode" render={(enabled) => (
 *   <div className={enabled ? 'dark' : 'light'}>Content</div>
 * )} />
 */
declare function Feature({ featureKey, featureKeys, requirement, negate, defaultValue, children, fallback, render, }: FeatureProps): ReactElement | null;
/**
 * Props for FeatureEnabled component
 */
interface FeatureEnabledProps {
    /** Feature key to check */
    featureKey: string;
    /** Default value if feature is not found */
    defaultValue?: boolean;
    /** Content to render when feature is enabled */
    children: ReactNode;
}
/**
 * Component that only renders children when feature is enabled
 *
 * @example
 * <FeatureEnabled featureKey="premium">
 *   <PremiumContent />
 * </FeatureEnabled>
 */
declare function FeatureEnabled({ featureKey, defaultValue, children, }: FeatureEnabledProps): ReactElement | null;
/**
 * Props for FeatureDisabled component
 */
interface FeatureDisabledProps {
    /** Feature key to check */
    featureKey: string;
    /** Default value if feature is not found */
    defaultValue?: boolean;
    /** Content to render when feature is disabled */
    children: ReactNode;
}
/**
 * Component that only renders children when feature is disabled
 *
 * @example
 * <FeatureDisabled featureKey="new-ui">
 *   <LegacyUI />
 * </FeatureDisabled>
 */
declare function FeatureDisabled({ featureKey, defaultValue, children, }: FeatureDisabledProps): ReactElement | null;
/**
 * Props for FeatureSwitch component
 */
interface FeatureSwitchProps {
    /** Feature key to check */
    featureKey: string;
    /** Default value if feature is not found */
    defaultValue?: boolean;
    /** Content to render when feature is enabled */
    enabled: ReactNode;
    /** Content to render when feature is disabled */
    disabled: ReactNode;
}
/**
 * Component that renders different content based on feature state
 *
 * @example
 * <FeatureSwitch
 *   featureKey="new-pricing"
 *   enabled={<NewPricing />}
 *   disabled={<OldPricing />}
 * />
 */
declare function FeatureSwitch({ featureKey, defaultValue, enabled, disabled, }: FeatureSwitchProps): ReactElement;
/**
 * Props for FeatureGate component
 */
interface FeatureGateProps {
    /** Feature keys to check */
    featureKeys: string[];
    /** Requirement type */
    requirement?: FeatureRequirement;
    /** Negate the check */
    negate?: boolean;
    /** Content to render when gate passes */
    children: ReactNode;
    /** Content to render when gate fails */
    fallback?: ReactNode;
}
/**
 * Component for checking multiple features
 *
 * @example
 * <FeatureGate featureKeys={["premium", "beta"]} requirement="all">
 *   <BetaFeature />
 * </FeatureGate>
 */
declare function FeatureGate({ featureKeys, requirement, negate, children, fallback, }: FeatureGateProps): ReactElement | null;

/**
 * Remix-specific utilities for Toggly
 */

/**
 * Props for RemixTogglyProvider
 */
interface RemixTogglyProviderProps extends Omit<TogglyProviderProps, 'serverContext'> {
    /** Route ID to get loader data from (optional) */
    routeId?: string;
    /** Fallback server context if not in loader data */
    fallbackContext?: ServerFeatureContext;
}
/**
 * Remix-specific Toggly Provider that automatically hydrates from loader data
 *
 * @example
 * // In root.tsx
 * export default function App() {
 *   return (
 *     <RemixTogglyProvider>
 *       <Outlet />
 *     </RemixTogglyProvider>
 *   );
 * }
 */
declare function RemixTogglyProvider({ children, routeId, fallbackContext, config, ...props }: RemixTogglyProviderProps): ReactElement;
/**
 * Hook to get Toggly context from loader data
 */
declare function useTogglyLoaderData<T extends Record<string, unknown> = Record<string, unknown>>(): {
    data: SerializeFrom<T>;
    toggly: ServerFeatureContext | undefined;
};
/**
 * Hook to get Toggly context from a specific route's loader data
 */
declare function useTogglyRouteLoaderData<T extends Record<string, unknown> = Record<string, unknown>>(routeId: string): {
    data: SerializeFrom<T> | undefined;
    toggly: ServerFeatureContext | undefined;
};
/**
 * Helper to extract server context from loader data
 */
declare function extractServerContext<T extends Record<string, unknown>>(loaderData: T & {
    [TOGGLY_LOADER_KEY]?: ServerFeatureContext;
}): ServerFeatureContext | undefined;
/**
 * Helper to check if loader data has Toggly context
 */
declare function hasTogglyContext<T extends Record<string, unknown>>(loaderData: T): loaderData is T & {
    [TOGGLY_LOADER_KEY]: ServerFeatureContext;
};
/**
 * Type helper for loader data with Toggly context
 */
type LoaderDataWithToggly<T extends Record<string, unknown>> = T & {
    [TOGGLY_LOADER_KEY]: ServerFeatureContext;
};
/**
 * Script component to inject Toggly flags for client-side hydration
 *
 * @example
 * // In root.tsx head
 * <TogglyScript serverContext={togglyContext} />
 */
declare function TogglyScript({ serverContext, nonce, }: {
    serverContext?: ServerFeatureContext;
    nonce?: string;
}): ReactElement | null;
/**
 * Get server context from window for client-side hydration
 */
declare function getWindowTogglyData(): ServerFeatureContext | undefined;

export { Feature, FeatureDisabled, FeatureEnabled, FeatureGate, FeatureSwitch, RemixTogglyProvider, TogglyContext, TogglyProvider, TogglyScript, extractServerContext, getWindowTogglyData, hasTogglyContext, useABTest, useFeature, useFeatureCallback, useFeatureChange, useFeatureDisabled, useFeatureFlags, useFeatureGate, useFeatureRender, useFeatureValue, useFeatureWithLoading, useFeatures, useIdentity, useRefreshFlags, useToggly, useTogglyContext, useTogglyLoaderData, useTogglyReady, useTogglyRouteLoaderData };
export type { FeatureDisabledProps, FeatureEnabledProps, FeatureGateProps, FeatureProps, FeatureSwitchProps, LoaderDataWithToggly, RemixTogglyProviderProps, TogglyContextValue, TogglyProviderProps };
