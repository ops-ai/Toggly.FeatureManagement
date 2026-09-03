/**
 * Feature component
 *
 * Component for conditional rendering based on a single feature flag.
 * Use `negate` to render when the feature is off (same as .NET `<feature negate>`).
 */

import React, { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { $flag, $isReady } from '../client/store.js';
import type { FeatureProps } from '../types/index.js';

/**
 * Feature - Component for conditional rendering based on a feature flag
 *
 * Renders children when the gate passes. Use `negate` for the off path.
 * Use `loading` while flags are not ready (not the same as a disabled branch).
 *
 * @example
 * ```tsx
 * <Feature flag="new-dashboard">
 *   <NewDashboard />
 * </Feature>
 * ```
 *
 * @example Off path with negate
 * ```tsx
 * <Feature flag="maintenance-mode" negate>
 *   <MainApp />
 * </Feature>
 * ```
 *
 * @example Entity context
 * ```tsx
 * <Feature flag="OrderBadge" context={order} contextKind="Order">
 *   <Badge />
 * </Feature>
 * ```
 */
export function Feature({
  flag,
  negate = false,
  context,
  contextKind,
  loading = null,
  children,
}: FeatureProps) {
  const isReady = useStore($isReady);
  const flagAtom = useMemo(
    () => $flag(flag, false, context, contextKind),
    [flag, context, contextKind],
  );
  const isOn = useStore(flagAtom);
  const isEnabled = negate ? !isOn : isOn;

  if (!isReady) {
    return <>{loading}</>;
  }

  return <>{isEnabled ? children : null}</>;
}
