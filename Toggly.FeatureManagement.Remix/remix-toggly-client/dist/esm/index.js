import { mergeConfig, createLogger, buildDefinitionsUrl, fetchWithTimeout, isFeatureEnabled, evaluateFeatureGate, TOGGLY_LOADER_KEY } from '@ops-ai/remix-toggly-core';
export { HEADERS, STORAGE_KEYS, TOGGLY_LOADER_KEY, TogglyConfigError, TogglyError, TogglyNetworkError, TogglyTimeoutError } from '@ops-ai/remix-toggly-core';
import { jsx, Fragment } from 'react/jsx-runtime';
import { createContext, useMemo, useState, useCallback, useEffect, useContext } from 'react';
import { useRouteLoaderData, useLoaderData } from '@remix-run/react';

// Create context with undefined default
const TogglyContext = createContext(undefined);
/**
 * Toggly Provider component
 */
function TogglyProvider({ children, serverContext, config, enableRefresh = false, refreshInterval = 60000, onFlagsChange, }) {
    const mergedConfig = useMemo(() => (config ? mergeConfig(config) : undefined), [config]);
    const logger = useMemo(() => createLogger(mergedConfig?.debug ?? false), [mergedConfig?.debug]);
    // Initialize state from server context
    const [flags, setFlags] = useState(serverContext?.flags ?? mergedConfig?.featureDefaults ?? {});
    const [identity, setIdentity] = useState(serverContext?.identity);
    const [isReady, setIsReady] = useState(!!serverContext);
    const [hooks, setHooks] = useState([]);
    const executeAfterRefresh = useCallback(async (newFlags) => {
        for (const hook of hooks) {
            if (hook.afterRefresh) {
                try {
                    await hook.afterRefresh(newFlags);
                }
                catch (error) {
                    logger.error(`Error in hook "${hook.getMetadata().name}.afterRefresh":`, error);
                }
            }
        }
    }, [hooks, logger]);
    // Fetch flags from API
    const fetchFlags = useCallback(async (userIdentity) => {
        if (!mergedConfig?.appKey) {
            logger.debug('No appKey, using current flags.');
            return flags;
        }
        try {
            const url = buildDefinitionsUrl(mergedConfig, userIdentity);
            logger.debug(`Fetching flags from: ${url}`);
            const response = await fetchWithTimeout(url, {}, mergedConfig.timeout);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const payload = await response.json();
            const newFlags = payload && typeof payload === 'object'
                ? payload
                : {};
            logger.debug(`Fetched ${Object.keys(newFlags).length} flags.`);
            return newFlags;
        }
        catch (error) {
            logger.warn('Failed to fetch flags:', error);
            return flags;
        }
    }, [mergedConfig, flags, logger]);
    // Update flags and trigger callbacks
    const updateFlags = useCallback(async (newFlags) => {
        setFlags(newFlags);
        await executeAfterRefresh(newFlags);
        onFlagsChange?.(newFlags);
    }, [executeAfterRefresh, onFlagsChange]);
    // Check if feature is enabled (sync for performance)
    const isEnabled = useCallback((featureKey, defaultValue = false) => {
        // Note: Hooks are async but we need sync API for React
        // Consider using useEffect for hook execution if needed
        return isFeatureEnabled(flags, featureKey, defaultValue);
    }, [flags]);
    // Check if feature is disabled
    const isDisabled = useCallback((featureKey, defaultValue = true) => {
        return !isEnabled(featureKey, !defaultValue);
    }, [isEnabled]);
    // Evaluate feature gate
    const evaluateGate = useCallback((featureKeys, requirement = 'all', negate = false) => {
        const result = evaluateFeatureGate(flags, featureKeys, requirement, negate, false);
        return result.enabled;
    }, [flags]);
    // Identify user
    const identify = useCallback(async (newIdentity, context) => {
        logger.debug(`Identifying user: ${newIdentity}`);
        // Execute beforeIdentify hooks
        for (const hook of hooks) {
            if (hook.beforeIdentify) {
                try {
                    await hook.beforeIdentify(newIdentity);
                }
                catch (error) {
                    logger.error(`Error in hook "${hook.getMetadata().name}.beforeIdentify":`, error);
                }
            }
        }
        setIdentity(newIdentity);
        // Fetch new flags with identity
        const newFlags = await fetchFlags(newIdentity);
        await updateFlags(newFlags);
        // Execute afterIdentify hooks
        for (let i = hooks.length - 1; i >= 0; i--) {
            const hook = hooks[i];
            if (hook.afterIdentify) {
                try {
                    await hook.afterIdentify(newIdentity, undefined);
                }
                catch (error) {
                    logger.error(`Error in hook "${hook.getMetadata().name}.afterIdentify":`, error);
                }
            }
        }
        setIsReady(true);
    }, [hooks, fetchFlags, updateFlags, logger]);
    // Reset identity
    const reset = useCallback(async () => {
        logger.debug('Resetting identity');
        setIdentity(undefined);
        // Fetch flags without identity
        const newFlags = await fetchFlags();
        await updateFlags(newFlags);
    }, [fetchFlags, updateFlags, logger]);
    // Refresh flags
    const refresh = useCallback(async () => {
        logger.debug('Refreshing flags');
        const newFlags = await fetchFlags(identity);
        await updateFlags(newFlags);
    }, [identity, fetchFlags, updateFlags, logger]);
    // Add hook
    const addHook = useCallback((hook) => {
        setHooks((currentHooks) => {
            const metadata = hook.getMetadata();
            const exists = currentHooks.find((h) => h.getMetadata().name === metadata.name);
            if (exists) {
                logger.warn(`Hook "${metadata.name}" already registered. Skipping.`);
                return currentHooks;
            }
            logger.debug(`Hook "${metadata.name}" registered.`);
            return [...currentHooks, hook];
        });
    }, [logger]);
    // Remove hook
    const removeHook = useCallback((name) => {
        let removed = false;
        setHooks((currentHooks) => {
            const index = currentHooks.findIndex((h) => h.getMetadata().name === name);
            if (index > -1) {
                logger.debug(`Hook "${name}" removed.`);
                removed = true;
                return [
                    ...currentHooks.slice(0, index),
                    ...currentHooks.slice(index + 1),
                ];
            }
            return currentHooks;
        });
        return removed;
    }, [logger]);
    // Set up refresh interval
    useEffect(() => {
        if (!enableRefresh || !mergedConfig?.appKey) {
            return;
        }
        logger.debug(`Setting up refresh interval: ${refreshInterval}ms`);
        const intervalId = setInterval(() => {
            refresh();
        }, refreshInterval);
        return () => {
            clearInterval(intervalId);
        };
    }, [enableRefresh, refreshInterval, refresh, mergedConfig?.appKey, logger]);
    // Initialize on mount if no server context
    useEffect(() => {
        if (!serverContext && mergedConfig?.appKey) {
            logger.debug('No server context, initializing client-side');
            fetchFlags(identity).then((newFlags) => {
                setFlags(newFlags);
                setIsReady(true);
            });
        }
    }, []);
    const contextValue = useMemo(() => ({
        flags,
        isReady,
        identity,
        isEnabled,
        isDisabled,
        evaluateGate,
        identify,
        reset,
        refresh,
        addHook,
        removeHook,
    }), [
        flags,
        isReady,
        identity,
        isEnabled,
        isDisabled,
        evaluateGate,
        identify,
        reset,
        refresh,
        addHook,
        removeHook,
    ]);
    return (jsx(TogglyContext.Provider, { value: contextValue, children: children }));
}
/**
 * Hook to access Toggly context
 */
function useTogglyContext() {
    const context = useContext(TogglyContext);
    if (!context) {
        throw new Error('useTogglyContext must be used within a TogglyProvider');
    }
    return context;
}

/**
 * React hooks for Toggly feature flags
 */
/**
 * Hook to access the Toggly context
 */
function useToggly() {
    return useTogglyContext();
}
/**
 * Hook to check if a feature is enabled
 */
function useFeature(featureKey, defaultValue = false) {
    const { isEnabled } = useTogglyContext();
    return isEnabled(featureKey, defaultValue);
}
/**
 * Hook to check if a feature is disabled
 */
function useFeatureDisabled(featureKey, defaultValue = true) {
    const { isDisabled } = useTogglyContext();
    return isDisabled(featureKey, defaultValue);
}
/**
 * Hook to evaluate a feature gate (multiple features)
 */
function useFeatureGate(featureKeys, requirement = 'all', negate = false) {
    const { evaluateGate } = useTogglyContext();
    return evaluateGate(featureKeys, requirement, negate);
}
/**
 * Hook to get all feature flags
 */
function useFeatureFlags() {
    const { flags } = useTogglyContext();
    return flags;
}
/**
 * Hook to check multiple features at once
 */
function useFeatures(featureKeys, defaultValue = false) {
    const { isEnabled } = useTogglyContext();
    return useMemo(() => {
        const result = {};
        for (const key of featureKeys) {
            result[key] = isEnabled(key, defaultValue);
        }
        return result;
    }, [featureKeys, isEnabled, defaultValue]);
}
/**
 * Hook for feature flag with callback
 */
function useFeatureCallback(featureKey, enabledCallback, disabledCallback, defaultValue = false) {
    const enabled = useFeature(featureKey, defaultValue);
    return enabled ? enabledCallback() : disabledCallback();
}
/**
 * Hook to get feature value with typing
 */
function useFeatureValue(featureKey, enabledValue, disabledValue, defaultValue = false) {
    const enabled = useFeature(featureKey, defaultValue);
    return enabled ? enabledValue : disabledValue;
}
/**
 * Hook to track feature flag changes
 */
function useFeatureChange(featureKey, _onChange) {
    const enabled = useFeature(featureKey);
    // Note: This is synchronous, effect-based tracking should use useEffect
    // in the component directly with enabled as dependency
    return enabled;
}
/**
 * Hook for identity management
 */
function useIdentity() {
    const { identity, identify, reset } = useTogglyContext();
    return {
        identity,
        identify,
        reset,
    };
}
/**
 * Hook to check if Toggly is ready
 */
function useTogglyReady() {
    const { isReady } = useTogglyContext();
    return isReady;
}
/**
 * Hook for refreshing flags
 */
function useRefreshFlags() {
    const { refresh } = useTogglyContext();
    return refresh;
}
/**
 * Hook for conditional rendering based on feature
 */
function useFeatureRender(featureKey, enabled, disabled, defaultValue = false) {
    const isEnabled = useFeature(featureKey, defaultValue);
    return isEnabled ? enabled : disabled;
}
/**
 * Hook for A/B testing with feature flags
 */
function useABTest(featureKey, variantA, variantB, defaultVariant = 'A') {
    const enabled = useFeature(featureKey, defaultVariant === 'B');
    return enabled ? variantB : variantA;
}
/**
 * Hook to get a feature with loading state
 */
function useFeatureWithLoading(featureKey, defaultValue = false) {
    const { isReady, isEnabled } = useTogglyContext();
    return {
        enabled: isEnabled(featureKey, defaultValue),
        isLoading: !isReady,
    };
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
function Feature({ featureKey, featureKeys, requirement = 'all', negate = false, defaultValue = false, children, fallback = null, render, }) {
    // Determine which hook to use
    const keys = featureKeys ?? (featureKey ? [featureKey] : []);
    // Use single feature hook for single key, gate hook for multiple
    const singleEnabled = useFeature(keys[0] ?? '', defaultValue);
    const gateEnabled = useFeatureGate(keys, requirement, false);
    // Calculate final enabled state
    let enabled;
    if (keys.length === 0) {
        enabled = defaultValue;
    }
    else if (keys.length === 1) {
        enabled = singleEnabled;
    }
    else {
        enabled = gateEnabled;
    }
    // Apply negation
    if (negate) {
        enabled = !enabled;
    }
    // Render prop takes precedence
    if (render) {
        return jsx(Fragment, { children: render(enabled) });
    }
    // Conditional rendering
    return jsx(Fragment, { children: enabled ? children : fallback });
}
/**
 * Component that only renders children when feature is enabled
 *
 * @example
 * <FeatureEnabled featureKey="premium">
 *   <PremiumContent />
 * </FeatureEnabled>
 */
function FeatureEnabled({ featureKey, defaultValue = false, children, }) {
    const enabled = useFeature(featureKey, defaultValue);
    return enabled ? jsx(Fragment, { children: children }) : null;
}
/**
 * Component that only renders children when feature is disabled
 *
 * @example
 * <FeatureDisabled featureKey="new-ui">
 *   <LegacyUI />
 * </FeatureDisabled>
 */
function FeatureDisabled({ featureKey, defaultValue = true, children, }) {
    const enabled = useFeature(featureKey, !defaultValue);
    return !enabled ? jsx(Fragment, { children: children }) : null;
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
function FeatureSwitch({ featureKey, defaultValue = false, enabled, disabled, }) {
    const isEnabled = useFeature(featureKey, defaultValue);
    return jsx(Fragment, { children: isEnabled ? enabled : disabled });
}
/**
 * Component for checking multiple features
 *
 * @example
 * <FeatureGate featureKeys={["premium", "beta"]} requirement="all">
 *   <BetaFeature />
 * </FeatureGate>
 */
function FeatureGate({ featureKeys, requirement = 'all', negate = false, children, fallback = null, }) {
    const enabled = useFeatureGate(featureKeys, requirement, negate);
    return jsx(Fragment, { children: enabled ? children : fallback });
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
function RemixTogglyProvider({ children, routeId, fallbackContext, config, ...props }) {
    // Get loader data
    let serverContext;
    try {
        if (routeId) {
            // Get from specific route
            const routeData = useRouteLoaderData(routeId);
            serverContext = routeData?.[TOGGLY_LOADER_KEY];
        }
        else {
            // Get from current route
            const loaderData = useLoaderData();
            serverContext = loaderData?.[TOGGLY_LOADER_KEY];
        }
    }
    catch {
        // Loader data not available (e.g., error boundary)
        serverContext = fallbackContext;
    }
    // Use fallback if no server context
    serverContext = serverContext ?? fallbackContext;
    // Merge config with server context
    const mergedConfig = config ?? (serverContext ? {
        appKey: serverContext.appKey,
        environment: serverContext.environment,
    } : undefined);
    return (jsx(TogglyProvider, { serverContext: serverContext, config: mergedConfig, ...props, children: children }));
}
/**
 * Hook to get Toggly context from loader data
 */
function useTogglyLoaderData() {
    const loaderData = useLoaderData();
    return {
        data: loaderData,
        toggly: loaderData[TOGGLY_LOADER_KEY],
    };
}
/**
 * Hook to get Toggly context from a specific route's loader data
 */
function useTogglyRouteLoaderData(routeId) {
    const routeData = useRouteLoaderData(routeId);
    return {
        data: routeData,
        toggly: routeData?.[TOGGLY_LOADER_KEY],
    };
}
/**
 * Helper to extract server context from loader data
 */
function extractServerContext(loaderData) {
    return loaderData[TOGGLY_LOADER_KEY];
}
/**
 * Helper to check if loader data has Toggly context
 */
function hasTogglyContext(loaderData) {
    const data = loaderData;
    return TOGGLY_LOADER_KEY in data && data[TOGGLY_LOADER_KEY] !== undefined;
}
/**
 * Script component to inject Toggly flags for client-side hydration
 *
 * @example
 * // In root.tsx head
 * <TogglyScript serverContext={togglyContext} />
 */
function TogglyScript({ serverContext, nonce, }) {
    if (!serverContext) {
        return null;
    }
    const script = `window.__TOGGLY_DATA__=${JSON.stringify(serverContext)};`;
    return (jsx("script", { nonce: nonce, dangerouslySetInnerHTML: { __html: script }, suppressHydrationWarning: true }));
}
/**
 * Get server context from window for client-side hydration
 */
function getWindowTogglyData() {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return window.__TOGGLY_DATA__;
}

export { Feature, FeatureDisabled, FeatureEnabled, FeatureGate, FeatureSwitch, RemixTogglyProvider, TogglyContext, TogglyProvider, TogglyScript, extractServerContext, getWindowTogglyData, hasTogglyContext, useABTest, useFeature, useFeatureCallback, useFeatureChange, useFeatureDisabled, useFeatureFlags, useFeatureGate, useFeatureRender, useFeatureValue, useFeatureWithLoading, useFeatures, useIdentity, useRefreshFlags, useToggly, useTogglyContext, useTogglyLoaderData, useTogglyReady, useTogglyRouteLoaderData };
//# sourceMappingURL=index.js.map
