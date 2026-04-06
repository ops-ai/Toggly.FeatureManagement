/**
 * React Feature Component for Astro Islands
 * 
 * Use this component in React islands within Astro for client-side feature flagging.
 * Integrates with nanostores for reactive state management.
 */

import { useStore } from '@nanostores/react';
import { $flags, $isReady, $variants } from '../../client/store.js';
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
  children: ReactNode;
  /** Content to render when flag is disabled (optional) */
  fallback?: ReactNode;
}

/**
 * Feature - React component for conditional rendering based on feature flags
 * 
 * @example
 * ```tsx
 * <Feature flag="new-dashboard">
 *   <Dashboard />
 * </Feature>
 * ```
 * 
 * @example Multiple flags with 'any' requirement
 * ```tsx
 * <Feature flags={['feature1', 'feature2']} requirement="any">
 *   <Content />
 * </Feature>
 * ```
 * 
 * @example With fallback
 * ```tsx
 * <Feature flag="premium-feature" fallback={<UpgradePrompt />}>
 *   <PremiumContent />
 * </Feature>
 * ```
 */
export function Feature({
  flag,
  flags,
  requirement = 'all',
  negate = false,
  children,
  fallback = null,
}: FeatureProps) {
  const allFlags = useStore($flags);
  const isReady = useStore($isReady);

  // Build flag keys array
  const flagKeys: string[] = [];
  if (flag) {
    flagKeys.push(flag);
  }
  if (flags && Array.isArray(flags)) {
    flagKeys.push(...flags);
  }

  // Wait for flags to be ready
  if (!isReady) {
    return <>{fallback}</>;
  }

  // No flags specified
  if (flagKeys.length === 0) {
    return <>{negate ? fallback : children}</>;
  }

  // Evaluate flags
  let isEnabled: boolean;

  if (requirement === 'any') {
    isEnabled = flagKeys.some((key) => allFlags[key] === true);
  } else {
    isEnabled = flagKeys.every((key) => allFlags[key] === true);
  }

  if (negate) {
    isEnabled = !isEnabled;
  }

  return <>{isEnabled ? children : fallback}</>;
}

/**
 * Hook to check if a feature flag is enabled
 * 
 * @param flagKey - Feature flag key to check
 * @param defaultValue - Default value if flag not found (default: false)
 * @returns Object with enabled state and ready state
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { enabled, isReady } = useFeatureFlag('new-dashboard');
 *   
 *   if (!isReady) return <Loading />;
 *   if (!enabled) return <OldDashboard />;
 *   return <NewDashboard />;
 * }
 * ```
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false
): { enabled: boolean; isReady: boolean } {
  const flags = useStore($flags);
  const isReady = useStore($isReady);

  const enabled = flags[flagKey] ?? defaultValue;

  return { enabled, isReady };
}

/**
 * Hook to check if multiple feature flags are enabled
 * 
 * @param flagKeys - Array of feature flag keys to check
 * @param requirement - 'all' or 'any' (default: 'all')
 * @param negate - If true, negates the result (default: false)
 * @returns Object with enabled state and ready state
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { enabled } = useFeatureGate(['feature1', 'feature2'], 'any');
 *   return enabled ? <NewFeatures /> : <OldFeatures />;
 * }
 * ```
 */
export function useFeatureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false
): { enabled: boolean; isReady: boolean } {
  const flags = useStore($flags);
  const isReady = useStore($isReady);

  if (flagKeys.length === 0) {
    return { enabled: !negate, isReady };
  }

  let isEnabled: boolean;

  if (requirement === 'any') {
    isEnabled = flagKeys.some((key) => flags[key] === true);
  } else {
    isEnabled = flagKeys.every((key) => flags[key] === true);
  }

  if (negate) {
    isEnabled = !isEnabled;
  }

  return { enabled: isEnabled, isReady };
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


