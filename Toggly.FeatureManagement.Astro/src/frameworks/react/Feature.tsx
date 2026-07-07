/**
 * React Feature Component for Astro Islands
 *
 * Use this component in React islands within Astro for client-side feature flagging.
 * Integrates with nanostores for reactive state management.
 */

import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { $flag, $gate, $isReady, $variants } from '../../client/store.js';
import type { VariantResult } from '../../types/index.js';
import type { ReactNode } from 'react';

export interface FeatureProps {
  /** Single feature flag key to check */
  flag?: string;
  /** Multiple feature flag keys to check */
  flags?: string[];
  /** Requirement for multiple flags: 'all' or 'any' (default: 'all') */
  requirement?: 'all' | 'any';
  /** If true, negates the result (default: false) */
  negate?: boolean;
  /** Content to render when flag is enabled */
  children?: ReactNode;
  /** Content to render when flag is disabled (optional) */
  fallback?: ReactNode;
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
): boolean {
  const flagKeys = useMemo(() => buildFlagKeys(flag, flags), [flag, flags]);
  const keysKey = flagKeys.join('\0');
  const gateAtom = useMemo(
    () => $gate(flagKeys, requirement, negate),
    [keysKey, requirement, negate],
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
  children,
  fallback = null,
  render,
}: FeatureProps) {
  const isReady = useStore($isReady);
  const isEnabled = useGateEnabled(flag, flags, requirement, negate);

  if (render) {
    if (!isReady) {
      return <>{render(false)}</>;
    }
    return <>{render(isEnabled)}</>;
  }

  if (!isReady) {
    return <>{fallback}</>;
  }

  const flagKeys = buildFlagKeys(flag, flags);
  if (flagKeys.length === 0) {
    return <>{negate ? fallback : children}</>;
  }

  return <>{isEnabled ? children : fallback}</>;
}

/**
 * Hook to check if a feature flag is enabled (includes local post-filter gates).
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false,
): { enabled: boolean; isReady: boolean } {
  const flagAtom = useMemo(() => $flag(flagKey, defaultValue), [flagKey, defaultValue]);
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
): { enabled: boolean; isReady: boolean } {
  const keysKey = flagKeys.join('\0');
  const gateAtom = useMemo(
    () => $gate(flagKeys, requirement, negate),
    [keysKey, requirement, negate],
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
