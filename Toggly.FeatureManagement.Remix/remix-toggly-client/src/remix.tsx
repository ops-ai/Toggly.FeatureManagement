/**
 * Remix-specific utilities for Toggly
 */

import React, { type ReactNode } from 'react';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import {
  ServerFeatureContext,
  TOGGLY_LOADER_KEY,
  TogglyConfig,
} from '@ops-ai/remix-toggly-core';
import { TogglyProvider, type TogglyProviderProps } from './context';

/**
 * Props for RemixTogglyProvider
 */
export interface RemixTogglyProviderProps extends Omit<TogglyProviderProps, 'serverContext'> {
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
export function RemixTogglyProvider({
  children,
  routeId,
  fallbackContext,
  config,
  ...props
}: RemixTogglyProviderProps): React.ReactElement {
  // Get loader data
  let serverContext: ServerFeatureContext | undefined;

  try {
    if (routeId) {
      // Get from specific route
      const routeData = useRouteLoaderData<Record<string, unknown>>(routeId);
      serverContext = routeData?.[TOGGLY_LOADER_KEY] as ServerFeatureContext | undefined;
    } else {
      // Get from current route
      const loaderData = useLoaderData<Record<string, unknown>>();
      serverContext = loaderData?.[TOGGLY_LOADER_KEY] as ServerFeatureContext | undefined;
    }
  } catch {
    // Loader data not available (e.g., error boundary)
    serverContext = fallbackContext;
  }

  // Use fallback if no server context
  serverContext = serverContext ?? fallbackContext;

  // Merge config with server context
  const mergedConfig: TogglyConfig | undefined = config ?? (serverContext ? {
    appKey: serverContext.appKey,
    environment: serverContext.environment,
  } : undefined);

  return (
    <TogglyProvider
      serverContext={serverContext}
      config={mergedConfig}
      {...props}
    >
      {children}
    </TogglyProvider>
  );
}

/**
 * Hook to get Toggly context from loader data
 */
export function useTogglyLoaderData<T extends Record<string, unknown> = Record<string, unknown>>(): {
  data: T;
  toggly: ServerFeatureContext | undefined;
} {
  const loaderData = useLoaderData<T & { [TOGGLY_LOADER_KEY]?: ServerFeatureContext }>();

  return {
    data: loaderData,
    toggly: loaderData[TOGGLY_LOADER_KEY],
  };
}

/**
 * Hook to get Toggly context from a specific route's loader data
 */
export function useTogglyRouteLoaderData<T extends Record<string, unknown> = Record<string, unknown>>(
  routeId: string
): {
  data: T | undefined;
  toggly: ServerFeatureContext | undefined;
} {
  const routeData = useRouteLoaderData<T & { [TOGGLY_LOADER_KEY]?: ServerFeatureContext }>(routeId);

  return {
    data: routeData,
    toggly: routeData?.[TOGGLY_LOADER_KEY],
  };
}

/**
 * Helper to extract server context from loader data
 */
export function extractServerContext<T extends Record<string, unknown>>(
  loaderData: T & { [TOGGLY_LOADER_KEY]?: ServerFeatureContext }
): ServerFeatureContext | undefined {
  return loaderData[TOGGLY_LOADER_KEY];
}

/**
 * Helper to check if loader data has Toggly context
 */
export function hasTogglyContext<T extends Record<string, unknown>>(
  loaderData: T
): loaderData is T & { [TOGGLY_LOADER_KEY]: ServerFeatureContext } {
  return TOGGLY_LOADER_KEY in loaderData && loaderData[TOGGLY_LOADER_KEY] !== undefined;
}

/**
 * Type helper for loader data with Toggly context
 */
export type LoaderDataWithToggly<T extends Record<string, unknown>> = T & {
  [TOGGLY_LOADER_KEY]: ServerFeatureContext;
};

/**
 * Script component to inject Toggly flags for client-side hydration
 *
 * @example
 * // In root.tsx head
 * <TogglyScript serverContext={togglyContext} />
 */
export function TogglyScript({
  serverContext,
  nonce,
}: {
  serverContext?: ServerFeatureContext;
  nonce?: string;
}): React.ReactElement | null {
  if (!serverContext) {
    return null;
  }

  const script = `window.__TOGGLY_DATA__=${JSON.stringify(serverContext)};`;

  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}

/**
 * Get server context from window for client-side hydration
 */
export function getWindowTogglyData(): ServerFeatureContext | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as unknown as { __TOGGLY_DATA__?: ServerFeatureContext }).__TOGGLY_DATA__;
}
