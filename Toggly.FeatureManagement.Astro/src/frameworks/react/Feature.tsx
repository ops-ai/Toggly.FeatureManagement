/**
 * React Feature Component for Astro Islands
 *
 * Use this component in React islands within Astro for client-side feature flagging.
 * Integrates with nanostores for reactive state management.
 * Use `negate` for the off path (same as .NET `<feature negate>`).
 */

import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { $flag, $gate, $isReady, $variants } from '../../client/store.js';
import type { VariantResult } from '../../types/index.js';
import type { ReactNode } from 'react';
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types';

export interface FeatureProps {
  /** Single feature flag key to check */
  flag?: string;
  /** Multiple feature flag keys to check */
  flags?: string[];
  /** Requirement for multiple flags: 'all' or 'any' (default: 'all') */
  requirement?: 'all' | 'any';
  /** If true, negates the result (default: false) */
  negate?: boolean;
  /** Entity instance or canonical entity context for entity-gated flags */
  context?: TogglyEntityContext | Record<string, unknown> | null;
  /** Context kind for registerContext mapper lookup when `context` is a domain object */
  contextKind?: string;
  /** Content to render when the gate passes */
  children?: ReactNode;
  /** Content to render while flags are not ready (not an off-path branch) */
  loading?: ReactNode;
  /** Render prop for conditional styling; always invoked with resolved gate boolean */
  render?: (enabled: boolean) => ReactNode;
}

function buildFlagKeys(flag?: string, flags?: string[]): string[] {
  const flagKeys: string[] = [];
  if (flag) {
    flagKeys.push(flag);
  }
  if (flags && Array.isArray(flags)) {
    flagKeys.push(...flags);
  }
  return flagKeys;
}

function useGateEnabled(
  flag?: string,
  flags?: string[],
  requirement: 'all' | 'any' = 'all',
  negate = false,
  context?: TogglyEntityContext | Record<string, unknown> | null,
  contextKind?: string,
): boolean {
  const flagKeys = useMemo(() => buildFlagKeys(flag, flags), [flag, flags]);
  const keysKey = flagKeys.join('\0');
  const gateAtom = useMemo(
    () => $gate(flagKeys, requirement, negate, context, contextKind),
    [keysKey, requirement, negate, context, contextKind],
  );
  return useStore(gateAtom);
}

/**
 * Feature - React component for conditional rendering based on feature flags
 */
export function Feature({
  flag,
  flags,
  requirement = 'all',
  negate = false,
  context,
  contextKind,
  children,
  loading = null,
  render,
}: FeatureProps) {
  const isReady = useStore($isReady);
  const isEnabled = useGateEnabled(flag, flags, requirement, negate, context, contextKind);

  if (render) {
    if (!isReady) {
      return <>{render(false)}</>;
    }
    return <>{render(isEnabled)}</>;
  }

  if (!isReady) {
    return <>{loading}</>;
  }

  return <>{isEnabled ? children : null}</>;
}

/**
 * Hook to check if a feature flag is enabled (includes local post-filter gates).
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false,
  context?: TogglyEntityContext | Record<string, unknown> | null,
  contextKind?: string,
): { enabled: boolean; isReady: boolean } {
  const flagAtom = useMemo(
    () => $flag(flagKey, defaultValue, context, contextKind),
    [flagKey, defaultValue, context, contextKind],
  );
  const enabled = useStore(flagAtom);
  const isReady = useStore($isReady);

  return { enabled, isReady };
}

/**
 * Hook to check if multiple feature flags are enabled (includes local post-filter gates).
 */
export function useFeatureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
  context?: TogglyEntityContext | Record<string, unknown> | null,
  contextKind?: string,
): { enabled: boolean; isReady: boolean } {
  const keysKey = flagKeys.join('\0');
  const gateAtom = useMemo(
    () => $gate(flagKeys, requirement, negate, context, contextKind),
    [keysKey, requirement, negate, context, contextKind],
  );
  const enabled = useStore(gateAtom);
  const isReady = useStore($isReady);

  return { enabled, isReady };
}

/**
 * Hook for the current variant assignment of a feature (requires enableVariants in config).
 */
export function useVariant(featureKey: string): VariantResult | null {
  const variants = useStore($variants);
  const entry = variants[featureKey];
  if (!entry?.variant) {
    return null;
  }
  return {
    name: entry.variant,
    configurationValue: entry.configurationValue,
  };
}

export default Feature;
