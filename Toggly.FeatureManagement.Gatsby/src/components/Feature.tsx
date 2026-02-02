/**
 * Feature component
 * 
 * Component for conditional rendering based on a single feature flag
 */

import React from 'react';
import { useStore } from '@nanostores/react';
import { $flags, $isReady } from '../client/store.js';
import type { FeatureProps } from '../types/index.js';

/**
 * Feature - Component for conditional rendering based on a feature flag
 * 
 * Renders children when the feature flag is enabled, otherwise renders fallback.
 * Waits for flags to be ready before evaluating.
 * 
 * @example
 * ```tsx
 * <Feature flag="new-dashboard">
 *   <NewDashboard />
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
export function Feature({ flag, fallback = null, children }: FeatureProps) {
  const flags = useStore($flags);
  const isReady = useStore($isReady);

  // Wait for flags to be ready
  if (!isReady) {
    return <>{fallback}</>;
  }

  // Check if flag is enabled
  const isEnabled = flags[flag] === true;

  return <>{isEnabled ? children : fallback}</>;
}
