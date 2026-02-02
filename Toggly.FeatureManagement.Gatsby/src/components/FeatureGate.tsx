/**
 * FeatureGate component
 * 
 * Component for conditional rendering based on multiple feature flags with gate logic
 */

import React from 'react';
import { useStore } from '@nanostores/react';
import { $flags, $isReady } from '../client/store.js';
import type { FeatureGateProps } from '../types/index.js';

/**
 * FeatureGate - Component for conditional rendering based on multiple feature flags
 * 
 * Renders children when the gate condition is met, otherwise renders fallback.
 * Supports 'all' (AND) and 'any' (OR) requirements, with optional negation.
 * 
 * @example All flags must be enabled
 * ```tsx
 * <FeatureGate flags={['feature1', 'feature2']} requirement="all">
 *   <Content />
 * </FeatureGate>
 * ```
 * 
 * @example At least one flag must be enabled
 * ```tsx
 * <FeatureGate flags={['premium', 'enterprise']} requirement="any">
 *   <PaidFeatures />
 * </FeatureGate>
 * ```
 * 
 * @example With negation (none of the flags should be enabled)
 * ```tsx
 * <FeatureGate 
 *   flags={['maintenance', 'downtime']} 
 *   requirement="any" 
 *   negate={true}
 *   fallback={<MaintenanceMessage />}
 * >
 *   <NormalContent />
 * </FeatureGate>
 * ```
 * 
 * @example With fallback
 * ```tsx
 * <FeatureGate 
 *   flags={['beta-access']} 
 *   fallback={<SignUpForBeta />}
 * >
 *   <BetaFeatures />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({
  flags: flagKeys,
  requirement = 'all',
  negate = false,
  fallback = null,
  children,
}: FeatureGateProps) {
  const flags = useStore($flags);
  const isReady = useStore($isReady);

  // Wait for flags to be ready
  if (!isReady) {
    return <>{fallback}</>;
  }

  // No flags specified
  if (flagKeys.length === 0) {
    return <>{negate ? fallback : children}</>;
  }

  // Evaluate flags based on requirement
  let isEnabled: boolean;

  if (requirement === 'any') {
    // At least one flag must be true
    isEnabled = flagKeys.some((key) => flags[key] === true);
  } else {
    // All flags must be true
    isEnabled = flagKeys.every((key) => flags[key] === true);
  }

  // Apply negation if requested
  if (negate) {
    isEnabled = !isEnabled;
  }

  return <>{isEnabled ? children : fallback}</>;
}
