/**
 * React Router-specific utilities for Toggly
 */

import { useLoaderData, useRouteLoaderData, useInRouterContext } from 'react-router';

// SerializeFrom was removed in React Router v2 — define a compatible alias
type SerializeFrom<T> = T;
import {
  TOGGLY_LOADER_KEY,
} from '../core';
import type { ReactElement } from 'react';
import type { ServerFeatureContext, TogglyConfig } from '../core';
import { serializeJsonForInlineScript } from '@ops-ai/toggly-hooks-types';
import { TogglyProvider, type TogglyProviderProps } from './context';

/**
 * Props for RouterTogglyProvider
 */
export interface RouterTogglyProviderProps extends Omit<TogglyProviderProps, 'serverContext'> {
  /** Route ID to get loader data from (optional) */
  routeId?: string;
  /** Fallback server context if not in loader data */
  fallbackContext?: ServerFeatureContext;
}

function resolveServerContext(
  data: Record<string, unknown> | undefined,
  fallbackContext?: ServerFeatureContext,
): ServerFeatureContext | undefined {
  const serverContext = data?.[TOGGLY_LOADER_KEY] as ServerFeatureContext | undefined;
  return serverContext ?? fallbackContext;
}

function buildMergedConfig(
  config: TogglyConfig | undefined,
  serverContext: ServerFeatureContext | undefined,
): TogglyConfig | undefined {
  return (
    config ??
    (serverContext
      ? {
          appKey: serverContext.appKey,
          environment: serverContext.environment,
        }
      : undefined)
  );
}

function RouterTogglyProviderInner({
  children,
  serverContext,
  config,
  ...props
}: TogglyProviderProps & { serverContext?: ServerFeatureContext }): ReactElement {
  const mergedConfig = buildMergedConfig(config, serverContext);

  return (
    <TogglyProvider serverContext={serverContext} config={mergedConfig} {...props}>
      {children}
    </TogglyProvider>
  );
}

function RouterTogglyProviderFromRoute({
  children,
  routeId,
  fallbackContext,
  config,
  ...props
}: RouterTogglyProviderProps & { routeId: string }): ReactElement {
  const routeData = useRouteLoaderData(routeId) as Record<string, unknown> | undefined;
  const serverContext = resolveServerContext(routeData, fallbackContext);

  return (
    <RouterTogglyProviderInner serverContext={serverContext} config={config} {...props}>
      {children}
    </RouterTogglyProviderInner>
  );
}

function RouterTogglyProviderFromLoader({
  children,
  fallbackContext,
  config,
  ...props
}: RouterTogglyProviderProps): ReactElement {
  const loaderData = useLoaderData() as Record<string, unknown> | undefined;
  const serverContext = resolveServerContext(loaderData, fallbackContext);

  return (
    <RouterTogglyProviderInner serverContext={serverContext} config={config} {...props}>
      {children}
    </RouterTogglyProviderInner>
  );
}

function RouterTogglyProviderStatic({
  children,
  fallbackContext,
  config,
  ...props
}: RouterTogglyProviderProps): ReactElement {
  const serverContext = fallbackContext ?? getWindowTogglyData();

  return (
    <RouterTogglyProviderInner serverContext={serverContext} config={config} {...props}>
      {children}
    </RouterTogglyProviderInner>
  );
}

/**
 * React Router-specific Toggly Provider that automatically hydrates from loader data
 *
 * @example
 * // In root.tsx
 * export default function App() {
 *   return (
 *     <RouterTogglyProvider>
 *       <Outlet />
 *     </RouterTogglyProvider>
 *   );
 * }
 */
export function RouterTogglyProvider({
  children,
  routeId,
  fallbackContext,
  config,
  ...props
}: RouterTogglyProviderProps): ReactElement {
  const inRouter = useInRouterContext();

  if (routeId) {
    return (
      <RouterTogglyProviderFromRoute routeId={routeId} fallbackContext={fallbackContext} config={config} {...props}>
        {children}
      </RouterTogglyProviderFromRoute>
    );
  }

  if (inRouter) {
    return (
      <RouterTogglyProviderFromLoader fallbackContext={fallbackContext} config={config} {...props}>
        {children}
      </RouterTogglyProviderFromLoader>
    );
  }

  return (
    <RouterTogglyProviderStatic fallbackContext={fallbackContext} config={config} {...props}>
      {children}
    </RouterTogglyProviderStatic>
  );
}

/**
 * Hook to get Toggly context from loader data
 */
export function useTogglyLoaderData<T extends Record<string, unknown> = Record<string, unknown>>(): {
  data: SerializeFrom<T>;
  toggly: ServerFeatureContext | undefined;
} {
  const loaderData = useLoaderData() as SerializeFrom<T> & {
    [TOGGLY_LOADER_KEY]?: ServerFeatureContext;
  };

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
  data: SerializeFrom<T> | undefined;
  toggly: ServerFeatureContext | undefined;
} {
  const routeData = useRouteLoaderData(routeId) as
    | (SerializeFrom<T> & { [TOGGLY_LOADER_KEY]?: ServerFeatureContext })
    | undefined;

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
  const data = loaderData as Record<string, unknown>;
  return TOGGLY_LOADER_KEY in data && data[TOGGLY_LOADER_KEY] !== undefined;
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
}): ReactElement | null {
  if (!serverContext) {
    return null;
  }

  // Prefer shared helper so escape stays consistent with Docusaurus / edge.
  const script = `window.__TOGGLY_DATA__=${serializeJsonForInlineScript(serverContext)};`;

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
