/**
 * React client bindings for Toggly in Docusaurus
 *
 * Provides React context, hooks, and components for feature flag evaluation
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { createTogglyClient, type TogglyConfig, type Flags } from '@ops-ai/toggly-client-core';

export interface TogglyProviderProps {
  config: TogglyConfig;
  children: ReactNode;
}

export interface TogglyContextValue {
  flags: Flags;
  isReady: boolean;
  getFlag: (key: string, defaultValue?: boolean) => Promise<boolean>;
  error: Error | null;
}

const TogglyContext = createContext<TogglyContextValue | null>(null);

/**
 * TogglyProvider - React context provider for Toggly feature flags
 *
 * Wrap your Docusaurus app with this provider to enable feature flag evaluation.
 * The config can be read from window.__TOGGLY_CONFIG__ (injected by the plugin)
 * or passed directly.
 *
 * @example
 * ```tsx
 * // Option 1: Read from window (recommended)
 * const config = (window as any).__TOGGLY_CONFIG__ || {};
 * <TogglyProvider config={config}>
 *   {children}
 * </TogglyProvider>
 *
 * // Option 2: Pass config directly
 * <TogglyProvider config={{ appKey: '...', environment: 'Production' }}>
 *   {children}
 * </TogglyProvider>
 * ```
 */
export function TogglyProvider({
  config: providedConfig,
  children,
}: TogglyProviderProps): JSX.Element {
  // If no config provided, try to read from window
  const config =
    providedConfig ||
    (typeof window !== 'undefined'
      ? (window as any).__TOGGLY_CONFIG__ || {}
      : {});
  const [client] = useState(() => {
    // Ensure we have a valid config
    if (!config || (!config.appKey && Object.keys(config).length === 0)) {
      console.warn(
        '[Toggly] No config provided. Please configure the plugin in docusaurus.config.js or pass config to TogglyProvider'
      );
    }
    return createTogglyClient(config);
  });
  const [flags, setFlags] = useState<Flags>({});
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Initialize client and load flags
    client
      .getFlags()
      .then((loadedFlags) => {
        setFlags(loadedFlags);
        setIsReady(true);
      })
      .catch((err) => {
        setError(err);
        setIsReady(true); // Still mark as ready even on error
      });
  }, [client]);

  const getFlag = async (key: string, defaultValue?: boolean): Promise<boolean> => {
    return client.getFlag(key, defaultValue);
  };

  const value: TogglyContextValue = {
    flags,
    isReady,
    getFlag,
    error,
  };

  return (
    <TogglyContext.Provider value={value}>{children}</TogglyContext.Provider>
  );
}

/**
 * useToggly - Hook to access Toggly context
 *
 * Returns the Toggly context value with flags and helper methods.
 */
export function useToggly(): TogglyContextValue {
  const context = useContext(TogglyContext);
  if (!context) {
    throw new Error('useToggly must be used within a TogglyProvider');
  }
  return context;
}

/**
 * useFlag - Hook to check if a feature flag is enabled
 *
 * @param flagKey - The key of the feature flag to check
 * @param defaultValue - Optional default value if flag is not found
 * @returns Object with enabled state and ready state
 */
export function useFlag(
  flagKey: string,
  defaultValue?: boolean
): { enabled: boolean; isReady: boolean } {
  const { flags, isReady, getFlag } = useToggly();
  const [enabled, setEnabled] = useState<boolean>(defaultValue ?? false);

  useEffect(() => {
    if (isReady) {
      // First check cached flags
      if (flags[flagKey] !== undefined) {
        setEnabled(flags[flagKey]);
      } else {
        // Fallback to async getFlag
        getFlag(flagKey, defaultValue).then(setEnabled);
      }
    }
  }, [flagKey, flags, isReady, getFlag, defaultValue]);

  return { enabled, isReady };
}

/**
 * Feature component - Conditionally renders children based on feature flag
 */
export interface FeatureProps {
  /** The feature flag key to check */
  flag: string;
  /** Content to render when flag is enabled */
  children: ReactNode;
  /** Content to render when flag is disabled (optional) */
  fallback?: ReactNode;
  /** Default value if flag is not found (default: false) */
  defaultValue?: boolean;
}

/**
 * Feature - React component for conditional rendering based on feature flags
 *
 * @example
 * ```tsx
 * <Feature flag="beta_advanced_filters">
 *   <h2>Advanced Filters (Beta)</h2>
 *   <p>This feature is in beta...</p>
 * </Feature>
 * ```
 */
export function Feature({
  flag,
  children,
  fallback = null,
  defaultValue = false,
}: FeatureProps): JSX.Element {
  const { enabled, isReady } = useFlag(flag, defaultValue);

  if (!isReady) {
    // While loading, show nothing or a loading state
    return <>{fallback}</>;
  }

  return <>{enabled ? children : fallback}</>;
}
