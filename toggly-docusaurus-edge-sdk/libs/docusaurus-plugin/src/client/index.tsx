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
import { createTogglyClient, type TogglyClient, type TogglyConfig, type Flags } from '../lib/toggly-client.js';

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

declare const __TOGGLY_BUILD_FLAGS__: Flags | undefined;
declare const __TOGGLY_STATIC_GATING__: boolean | undefined;

/**
 * Whether this bundle was built with `staticGating: true` (flags baked at build).
 */
export function isStaticGatingMode(): boolean {
  return typeof __TOGGLY_STATIC_GATING__ !== 'undefined' && __TOGGLY_STATIC_GATING__ === true;
}

function sanitizeFlags(raw: unknown): Flags {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Flags = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Build-time flag map injected by the plugin when `staticGating` is enabled.
 */
export function readBuildFlagsSnapshot(): Flags | null {
  if (typeof __TOGGLY_BUILD_FLAGS__ === 'undefined') {
    if (typeof window !== 'undefined') {
      const fromWindow = (window as unknown as Record<string, unknown>).__TOGGLY_BUILD_FLAGS__;
      if (fromWindow) {
        return sanitizeFlags(fromWindow);
      }
    }
    return null;
  }
  return sanitizeFlags(__TOGGLY_BUILD_FLAGS__);
}

/**
 * Name of the global the edge worker (cloudflare/worker) writes the resolved
 * flag map onto. Kept in sync with `SNAPSHOT_GLOBAL` in
 * `cloudflare/worker/src/html-rewriter.ts`.
 */
const EDGE_FLAGS_GLOBAL = '__TOGGLY_EDGE_FLAGS__';

/**
 * Read the flag snapshot the edge worker injected into the page so the React
 * tree on first client render can match the post-edge-strip DOM.
 *
 * Returns:
 *  - `null` if running on the server, or no snapshot was injected (e.g. no
 *    edge worker deployed). Callers should fall back to legacy behavior in
 *    that case.
 *  - A sanitised `Flags` map otherwise. Non-boolean values are dropped so a
 *    tampered global cannot smuggle unexpected types into the React tree.
 */
export function readEdgeFlagsSnapshot(): Flags | null {
  if (isStaticGatingMode()) {
    return readBuildFlagsSnapshot();
  }

  if (typeof window === 'undefined') {
    return null;
  }
  const raw = (window as unknown as Record<string, unknown>)[EDGE_FLAGS_GLOBAL];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return sanitizeFlags(raw);
}

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
  const staticGating = isStaticGatingMode();
  const initialFlags = readBuildFlagsSnapshot() ?? readEdgeFlagsSnapshot() ?? {};

  const [client] = useState(() => {
    if (staticGating) {
      return null;
    }
    // Ensure we have a valid config
    if (!config || (!config.appKey && Object.keys(config).length === 0)) {
      console.warn(
        '[Toggly] No config provided. Please configure the plugin in docusaurus.config.js or pass config to TogglyProvider'
      );
    }
    return createTogglyClient(config);
  });
  const [flags, setFlags] = useState<Flags>(() => initialFlags);
  const [isReady, setIsReady] = useState(() => staticGating || readEdgeFlagsSnapshot() !== null);
  const [error, setError] = useState<Error | null>(null);

  // Keep a ref to the latest flags so the polling interval can detect changes
  const flagsRef = useRef<Flags>(flags);
  flagsRef.current = flags;

  useEffect(() => {
    if (staticGating || !client) {
      return;
    }

    let pollTimer: ReturnType<typeof setInterval> | null = null;

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
  }, [client, staticGating, config.featureFlagsRefreshInterval]);

  const getFlag = async (key: string, defaultValue?: boolean): Promise<boolean> => {
    if (staticGating) {
      return flags[key] ?? defaultValue ?? false;
    }
    if (!client) {
      return defaultValue ?? false;
    }
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
  // Lazy initializer reads the already-populated flag map (e.g. the edge
  // snapshot seeded by TogglyProvider) so the very first render reflects
  // the resolved value. This is what lets Feature components emit a tree
  // that matches the post-edge-strip DOM during React hydration.
  const [enabled, setEnabled] = useState<boolean>(() =>
    flags[flagKey] !== undefined ? flags[flagKey] : defaultValue ?? false,
  );

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
  /** Content to render when the gate passes */
  children: ReactNode;
  /** When true, render children when the feature is off */
  negate?: boolean;
  /** Default value if flag is not found (default: false) */
  defaultValue?: boolean;
  /**
   * HTML element to use as wrapper (default: 'div').
   *
   * For 'div' and 'span' the wrapper uses `display: contents` so it does not
   * affect layout — useful for inline content gating that should be invisible
   * structurally.
   *
   * For other element types (e.g. 'li', 'tr', 'section'), no `display: contents`
   * is applied so the wrapper participates in the surrounding layout. This is
   * useful for gating list items so the entire bullet (including the marker)
   * is removed when the flag is disabled, instead of leaving an empty bullet.
   */
  as?: keyof JSX.IntrinsicElements;
}

/**
 * Check if we're in SSR (static build) mode
 */
const isSSR = typeof window === 'undefined';

/**
 * Feature - React component for conditional rendering based on feature flags
 *
 * Lifecycle of the wrapper across rendering passes:
 *  1. Static build (SSG): renders `<Element data-feature={flag}>` for every
 *     flag, regardless of state, so the build is deterministic and anchors
 *     exist for every gated section.
 *  2. Edge (Cloudflare Worker): `HTMLRewriter` strips wrappers whose flag is
 *     disabled, and injects `window.__TOGGLY_EDGE_FLAGS__` with the resolved
 *     flag map.
 *  3. Client first render: `TogglyProvider` reads the snapshot synchronously
 *     so this component evaluates the flag with the same answer the edge used,
 *     producing a tree that matches the post-strip DOM and lets React 18
 *     hydrate cleanly. When no edge worker is deployed (no snapshot present)
 *     the wrapper is rendered until the client SDK loads flags, matching the
 *     untransformed origin HTML.
 *  4. Steady state: WebSocket / polling refresh updates flags, which triggers
 *     a normal re-render — never a hydration mismatch since hydration is done.
 *
 * The wrapper uses `display: contents` so it doesn't affect layout.
 * Use the `as` prop to specify 'span' for inline content, or e.g. 'li' so
 * the entire list item (marker included) is removed when disabled.
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
/**
 * For 'div' and 'span' the wrapper should be invisible to layout. For any
 * other element type the wrapper is part of the layout (e.g. an `<li>` inside
 * a `<ul>`) and must render normally.
 */
function getWrapperStyle(
  element: keyof JSX.IntrinsicElements,
): React.CSSProperties | undefined {
  if (element === 'div' || element === 'span') {
    return { display: 'contents' as const };
  }
  return undefined;
}

export function Feature({
  flag,
  children,
  negate = false,
  defaultValue = false,
  as: Element = 'div',
}: FeatureProps): JSX.Element {
  const wrapperStyle = getWrapperStyle(Element);
  const buildFlags = readBuildFlagsSnapshot();

  // Build-time static gating: evaluate flags during SSG and on the client
  // using the same baked-in map — no runtime API, no flash.
  if (isStaticGatingMode() && buildFlags) {
    const enabled = buildFlags[flag] ?? defaultValue;
    const show = negate ? !enabled : enabled;
    if (!show) {
      return <></>;
    }
    return <Element style={wrapperStyle}>{children}</Element>;
  }

  // Edge mode: SSR emits data-feature wrappers for the worker to strip.
  // Negate is evaluated on the client; edge HTMLRewriter only strips positive
  // `data-feature` matches, so negated content always hydrates client-side.
  if (isSSR) {
    if (negate) {
      return (
        <Element data-feature={flag} data-toggly-negate="true" style={wrapperStyle}>
          {children}
        </Element>
      );
    }
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
      negate={negate}
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
  negate = false,
  defaultValue = false,
  as: Element = 'div',
}: FeatureProps): JSX.Element {
  const { enabled, isReady } = useFlag(flag, defaultValue);
  const wrapperStyle = getWrapperStyle(Element);
  const show = negate ? !enabled : enabled;

  // Always wrap with data-feature for edge worker compatibility

  // If still loading, show children wrapped (for hydration match with SSR)
  if (!isReady) {
    return (
      <Element data-feature={flag} style={wrapperStyle}>
        {children}
      </Element>
    );
  }

  // When ready, show content when the gate passes
  if (show) {
    return (
      <Element data-feature={flag} style={wrapperStyle}>
        {children}
      </Element>
    );
  }

  // Feature gate failed - render nothing (use a separate Feature with negate for off path)
  return <></>;
}
