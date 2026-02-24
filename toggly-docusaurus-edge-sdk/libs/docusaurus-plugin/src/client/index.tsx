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
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { createTogglyClient, type TogglyClient, type TogglyConfig, type Flags } from '../lib/toggly-client';

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

  // Keep a ref to the latest flags so the polling interval can detect changes
  const flagsRef = useRef<Flags>(flags);
  flagsRef.current = flags;

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Initialize client and load flags
    client
      .getFlags()
      .then((loadedFlags: Flags) => {
        setFlags(loadedFlags);
        setIsReady(true);
      })
      .catch((err: Error) => {
        setError(err);
        setIsReady(true); // Still mark as ready even on error
      });

    // Start WebSocket for live updates
    client.startWebSocket();

    // Poll periodically so React state picks up refreshes triggered by WebSocket
    pollTimer = setInterval(() => {
      client.getFlags().then((latest: Flags) => {
        // Only update state when flags actually changed
        if (JSON.stringify(latest) !== JSON.stringify(flagsRef.current)) {
          setFlags(latest);
        }
      }).catch(() => {
        // Silently ignore polling errors
      });
    }, config.featureFlagsRefreshInterval ?? 3 * 60 * 1000);

    return () => {
      client.stopWebSocket();
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
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
  /** 
   * HTML element to use as wrapper (default: 'div').
   * The wrapper uses `display: contents` so it doesn't affect layout.
   * Use 'span' for inline content if needed.
   */
  as?: 'div' | 'span';
}

/**
 * Check if we're in SSR (static build) mode
 */
const isSSR = typeof window === 'undefined';

/**
 * Feature - React component for conditional rendering based on feature flags
 *
 * This component wraps children in a `data-feature` element that:
 * 1. During static build: Renders all content (so anchors exist, build passes)
 * 2. At the edge (Cloudflare Worker): HTMLRewriter removes disabled content
 * 3. At runtime: Falls back to client-side evaluation if no edge worker
 *
 * The wrapper uses `display: contents` so it doesn't affect layout.
 * Use the `as` prop to specify 'span' for inline content.
 *
 * @example
 * ```tsx
 * // Block content (default)
 * <Feature flag="beta_advanced_filters">
 *   <h2>Advanced Filters (Beta)</h2>
 *   <p>This feature is in beta...</p>
 * </Feature>
 *
 * // Inline content
 * <Feature flag="beta" as="span">new beta feature</Feature>
 * ```
 */
export function Feature({
  flag,
  children,
  fallback = null,
  defaultValue = false,
  as: Element = 'div',
}: FeatureProps): JSX.Element {
  // Wrapper style - display: contents makes it invisible to layout
  const wrapperStyle = { display: 'contents' as const };

  // During SSR, render children with data-feature attribute
  // The Cloudflare Worker will strip disabled features at the edge
  if (isSSR) {
    return (
      <Element data-feature={flag} style={wrapperStyle}>
        {children}
      </Element>
    );
  }

  // Client-side rendering - use actual flag evaluation
  return (
    <FeatureClient 
      flag={flag} 
      fallback={fallback} 
      defaultValue={defaultValue}
      as={Element}
    >
      {children}
    </FeatureClient>
  );
}

/**
 * Client-side Feature component that uses hooks
 * Separated to avoid hooks being called during SSR
 */
function FeatureClient({
  flag,
  children,
  fallback = null,
  defaultValue = false,
  as: Element = 'div',
}: FeatureProps): JSX.Element {
  const { enabled, isReady } = useFlag(flag, defaultValue);
  
  // Wrapper style - display: contents makes it invisible to layout
  const wrapperStyle = { display: 'contents' as const };

  // Always wrap with data-feature for edge worker compatibility
  // The wrapper is invisible to layout due to display: contents
  
  // If still loading, show children wrapped (for hydration match with SSR)
  if (!isReady) {
    return (
      <Element data-feature={flag} style={wrapperStyle}>
        {children}
      </Element>
    );
  }

  // When ready, show enabled content or fallback
  // Keep the wrapper for consistency (edge worker will handle removal if disabled)
  if (enabled) {
    return (
      <Element data-feature={flag} style={wrapperStyle}>
        {children}
      </Element>
    );
  }

  // Feature is disabled - render fallback (no wrapper needed)
  return <>{fallback}</>;
}
