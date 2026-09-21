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
  useMemo,
  ReactNode,
} from 'react';
import {
  createTogglyClient,
  type TogglyClient,
  type TogglyConfig,
  type Flags,
} from '../lib/toggly-client.js';

export interface TogglyProviderProps {
  config: TogglyConfig;
  children: ReactNode;
}

export interface TogglyContextValue
  extends Pick<
    TogglyClient,
    'recordUsage' | 'recordView' | 'incrementCounter' | 'setGauge' | 'flushTelemetry'
  > {
  evaluateFlag: (key: string, defaultValue?: boolean) => boolean;
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
}: TogglyProviderProps): React.JSX.Element {
  const config =
    providedConfig ||
    (typeof window !== 'undefined' ? (window as any).__TOGGLY_CONFIG__ || {} : {});
  // Changing targeting/application options retires the complete prior owner.
  const key = JSON.stringify(config);
  const pageOwner = useRef(key);
  return (
    <ProviderOwner key={key} config={config} usePageSnapshot={pageOwner.current === key}>
      {children}
    </ProviderOwner>
  );
}

function ProviderOwner({
  config,
  children,
  usePageSnapshot,
}: TogglyProviderProps & { usePageSnapshot: boolean }): React.JSX.Element {
  const staticGating = isStaticGatingMode();
  const [client] = useState(() => createTogglyClient(config));
  const [flags, setFlags] = useState<Flags>(() =>
    staticGating
      ? usePageSnapshot
        ? (readBuildFlagsSnapshot() ?? {})
        : { ...config.flagDefaults }
      : usePageSnapshot
        ? (readEdgeFlagsSnapshot() ?? {})
        : {}
  );
  const [isReady, setIsReady] = useState(
    () => staticGating || (usePageSnapshot && readEdgeFlagsSnapshot() !== null)
  );
  const [error, setError] = useState<Error | null>(null);
  const leases = useRef(0);
  useEffect(() => {
    leases.current++;
    let active = true;
    client.startTelemetry();
    const apply = (latest: Flags) => {
      if (!active) return;
      setFlags((previous) =>
        JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest
      );
      setIsReady(true);
    };
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    if (!staticGating) {
      client
        .getFlags()
        .then(apply)
        .catch((err: Error) => {
          if (active) {
            setError(err);
            setIsReady(true);
          }
        });
      client.startWebSocket();
      pollTimer = setInterval(
        () => {
          void client
            .getFlags()
            .then(apply)
            .catch(() => {});
        },
        config.featureFlagsRefreshInterval ?? 3 * 60 * 1000
      );
    }
    return () => {
      active = false;
      leases.current--;
      client.stopWebSocket();
      clearInterval(pollTimer);
      // Effect replay reacquires the same owner synchronously. A real unmount
      // releases it at the next microtask; public client.dispose remains synchronous.
      queueMicrotask(() => {
        if (leases.current === 0) client.dispose();
      });
    };
  }, [client, staticGating]);
  const evaluateFlag = useCallback(
    (key: string, fallback?: boolean) => client.evaluateFlag(key, flags, fallback),
    [client, flags]
  );
  const getFlag = useCallback(
    async (key: string, fallback?: boolean) =>
      staticGating ? evaluateFlag(key, fallback) : client.getFlag(key, fallback),
    [client, staticGating, evaluateFlag]
  );
  const value = useMemo<TogglyContextValue>(
    () => ({
      flags,
      isReady,
      getFlag,
      evaluateFlag,
      error,
      recordUsage: client.recordUsage,
      recordView: client.recordView,
      incrementCounter: client.incrementCounter,
      setGauge: client.setGauge,
      flushTelemetry: client.flushTelemetry,
    }),
    [client, flags, isReady, getFlag, evaluateFlag, error]
  );
  return <TogglyContext.Provider value={value}>{children}</TogglyContext.Provider>;
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
  const { flags, isReady, evaluateFlag } = useToggly();
  const enabled = flags[flagKey] ?? defaultValue ?? false;
  const evaluated = useRef<{
    flags: Flags;
    key: string;
    fallback: boolean | undefined;
    evaluate: typeof evaluateFlag;
  }>();
  useEffect(() => {
    if (!isReady) return;
    const previous = evaluated.current;
    if (
      previous?.flags === flags &&
      previous.key === flagKey &&
      previous.fallback === defaultValue &&
      previous.evaluate === evaluateFlag
    )
      return;
    evaluated.current = { flags, key: flagKey, fallback: defaultValue, evaluate: evaluateFlag };
    evaluateFlag(flagKey, defaultValue);
  }, [flagKey, flags, isReady, evaluateFlag, defaultValue]);

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
  as?: keyof React.JSX.IntrinsicElements;
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
  element: keyof React.JSX.IntrinsicElements
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
}: FeatureProps): React.JSX.Element {
  const context = useContext(TogglyContext);
  const lastStatic = useRef<{
    evaluate: TogglyContextValue['evaluateFlag'];
    flag: string;
    fallback: boolean;
  }>();
  useEffect(() => {
    if (!isStaticGatingMode() || !context?.isReady) return;
    const previous = lastStatic.current;
    if (
      previous?.evaluate === context.evaluateFlag &&
      previous.flag === flag &&
      previous.fallback === defaultValue
    )
      return;
    lastStatic.current = { evaluate: context.evaluateFlag, flag, fallback: defaultValue };
    context.evaluateFlag(flag, defaultValue);
  }, [context?.evaluateFlag, context?.isReady, flag, defaultValue]);
  const wrapperStyle = getWrapperStyle(Element);
  const buildFlags = context?.flags ?? readBuildFlagsSnapshot();

  // The original owner shares the baked SSG map. A replacement owner uses
  // its own defaults so another application's snapshot cannot cross owners.
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
    <FeatureClient flag={flag} negate={negate} defaultValue={defaultValue} as={Element}>
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
}: FeatureProps): React.JSX.Element {
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
