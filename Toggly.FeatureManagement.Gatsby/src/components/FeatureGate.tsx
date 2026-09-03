/**
 * FeatureGate component
 *
 * Component for conditional rendering based on multiple feature flags with gate logic.
 * Use `negate` to render when the gate fails (same as .NET `<feature negate>`).
 */

import React, { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { $gate, $isReady } from '../client/store.js';
import type { FeatureGateProps } from '../types/index.js';

/**
 * FeatureGate - Component for conditional rendering based on multiple feature flags
 *
 * Renders children when the gate condition is met. Supports 'all' (AND) and 'any' (OR),
 * with optional negation. Use `loading` while flags are not ready.
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
 * @example With negation (show when none of the flags are enabled)
 * ```tsx
 * <FeatureGate
 *   flags={['maintenance', 'downtime']}
 *   requirement="any"
 *   negate={true}
 * >
 *   <NormalContent />
 * </FeatureGate>
 * ```
 *
 * @example Entity context
 * ```tsx
 * <FeatureGate flags={['OrderBadge']} context={order} contextKind="Order">
 *   <Badge />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({
  flags: flagKeys,
  requirement = 'all',
  negate = false,
  context,
  contextKind,
  loading = null,
  children,
}: FeatureGateProps) {
  const isReady = useStore($isReady);
  const keysKey = flagKeys.join('\0');
  const gateAtom = useMemo(
    () => $gate(flagKeys, requirement, negate, context, contextKind),
    [keysKey, requirement, negate, context, contextKind],
  );
  const isEnabled = useStore(gateAtom);

  if (!isReady) {
    return <>{loading}</>;
  }

  return <>{isEnabled ? children : null}</>;
}
